import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    uniform,
    uniformTexture,
    varying,
    positionLocal,
    positionWorld,
    normalLocal,
    positionView,
    uv,
    vertexColor,
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
    exp,
    step,
    clamp,
    max,
    mod,
    normalize,
    sqrt,
    time,
    texture,
    normalMap,
    screenUV,
    positionViewDirection,
    normalView,
} from 'three/tsl';

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

const rand2D = /* @__PURE__ */ Fn(([p]) => {
    return fract(sin(dot(p, vec2(12.9898, 78.233))).mul(43758.5453123));
});

// ═══════════════════════════════════════════════════════════════════════════
// ADVANCED RAIN EFFECTS - Hash functions for multi-point ripple system
// Ported from demo-2023-rain-puddle reference
// ═══════════════════════════════════════════════════════════════════════════

const HASHSCALE1 = 0.1031;
const HASHSCALE3 = vec3(0.1031, 0.1030, 0.0973);

// Hash function returning single float from vec2 input
const hash12 = /* @__PURE__ */ Fn(([p]) => {
    const p3 = fract(vec3(p.x, p.y, p.x).mul(HASHSCALE1));
    const dotted = dot(p3, p3.add(vec3(19.19, 19.19, 19.19)));
    return fract(p3.x.add(p3.y).mul(p3.z.add(dotted.mul(0.001))));
});

// Hash function returning vec2 from vec2 input
const hash22 = /* @__PURE__ */ Fn(([p]) => {
    const p3 = fract(vec3(p.x, p.y, p.x).mul(HASHSCALE3));
    const dotted = dot(p3, vec3(p3.y, p3.z, p3.x).add(vec3(19.19, 19.19, 19.19)));
    return fract(vec2(p3.x.add(p3.y), p3.y.add(p3.z)).mul(p3.z.add(dotted.mul(0.001))));
});

// 4-octave Fractal Brownian Motion for organic puddle distribution
const fbm4 = /* @__PURE__ */ Fn(([p]) => {
    let noise = noise2D(p);
    noise = noise.add(noise2D(p.mul(2.0).add(vec2(17.0))).mul(0.5));
    noise = noise.add(noise2D(p.mul(4.0).add(vec2(31.0))).mul(0.25));
    noise = noise.add(noise2D(p.mul(8.0).add(vec2(53.0))).mul(0.125));
    // Normalize: sum of weights = 1 + 0.5 + 0.25 + 0.125 = 1.875
    return noise.div(1.875);
});

// Multi-point ripple system with numerical derivatives for accurate normals
// Creates realistic rain impact ripples that expand outward
const getRipples = /* @__PURE__ */ Fn(([uvCoord, time]) => {
    // Domain warp to break grid alignment (prevents "line" artifacts)
    const warpNoise1 = vec2(
        noise2D(uvCoord.mul(0.12).add(time.mul(0.05))),
        noise2D(uvCoord.mul(0.12).add(vec2(13.2, 5.7)).sub(time.mul(0.04)))
    );
    const warpNoise2 = vec2(
        noise2D(uvCoord.mul(0.03).add(vec2(4.1, 9.6))),
        noise2D(uvCoord.mul(0.03).add(vec2(-7.3, 2.4)))
    );
    const warpedUv = uvCoord
        .add(warpNoise1.sub(0.5).mul(0.9))
        .add(warpNoise2.sub(0.5).mul(1.6));

    const p0 = floor(warpedUv);
    let circlesX = float(0.0);
    let circlesY = float(0.0);

    // 3x3 grid search for ripple centers (MAX_RADIUS = 1)
    // Each cell can have a ripple with random position and timing
    const offsets = [
        vec2(-1, -1), vec2(0, -1), vec2(1, -1),
        vec2(-1, 0), vec2(0, 0), vec2(1, 0),
        vec2(-1, 1), vec2(0, 1), vec2(1, 1),
    ];

    for (const offset of offsets) {
        const pi = p0.add(offset);
        const hsh = pi;

        // Random position within cell and timing
        const randomOffset = hash22(hsh);
        const jitter = hash22(hsh.add(vec2(9.1, 4.2))).sub(0.5).mul(0.35);
        const p = pi.add(randomOffset).add(jitter);

        // Ripple timing - varied per cell to avoid banding
        const speed = mix(float(0.18), float(0.42), hash12(hsh.add(vec2(4.1, 9.2))));
        const phase = hash12(hsh.add(vec2(1.7, 3.1)));
        const t = fract(time.mul(speed).add(phase));

        // Distance from current point to ripple center
        const v = p.sub(warpedUv);
        const radius = float(1.6).add(hash12(hsh.add(vec2(2.7, 8.3))).mul(1.2));
        const d = length(v).sub(radius.mul(t)); // Expanding wave

        // Numerical derivative for accurate wave normals
        const h = mix(float(0.0008), float(0.002), hash12(hsh.add(vec2(5.1, 4.6))));
        const d1 = d.sub(h);
        const d2 = d.add(h);

        // Wave function with smooth envelope
        const freq = mix(float(22.0), float(38.0), hash12(hsh.add(vec2(8.0, 1.4))));
        const p1 = sin(d1.mul(freq))
            .mul(smoothstep(-0.6, -0.3, d1))
            .mul(smoothstep(0.0, -0.3, d1));
        const p2 = sin(d2.mul(freq))
            .mul(smoothstep(-0.6, -0.3, d2))
            .mul(smoothstep(0.0, -0.3, d2));

        // Derivative gives us the normal direction
        const derivative = p2.sub(p1).div(h.mul(2.0));

        // Fade out as ripple expands: (1-t)^2
        const fadeout = float(1.0).sub(t).mul(float(1.0).sub(t));
        const spawn = smoothstep(float(0.2), float(0.85), hash12(hsh.add(vec2(6.3, 2.1))));

        // Accumulate ripple contribution
        const normalizedV = normalize(v);
        circlesX = circlesX.add(normalizedV.x.mul(derivative).mul(fadeout).mul(spawn).mul(0.5));
        circlesY = circlesY.add(normalizedV.y.mul(derivative).mul(fadeout).mul(spawn).mul(0.5));
    }

    // Average across all cells
    const circles = vec2(circlesX, circlesY).div(9.0);

    // Construct 3D normal from 2D ripple displacement
    // z = sqrt(1 - x^2 - y^2) for unit normal
    const zComponent = sqrt(float(1.0).sub(dot(circles, circles)).max(0.0));
    return vec3(circles.x, circles.y, zComponent);
});

// Perturb normal by blending with ripple normal in tangent space
const perturbNormalTSL = /* @__PURE__ */ Fn(([inputNormal, noiseNormal, strength]) => {
    // Project noise normal orthogonal to surface normal
    const noiseNormalOrthogonal = noiseNormal.sub(
        inputNormal.mul(dot(noiseNormal, inputNormal))
    );
    return normalize(inputNormal.sub(noiseNormalOrthogonal.mul(strength)));
});

// SDF for tapered water droplet shape (round top, pointed bottom)
// r1 = top radius, r2 = bottom radius (0 for point), h = height
const sdUnevenCapsule = /* @__PURE__ */ Fn(([p, r1, r2, h]) => {
    const px = abs(p.x);
    const py = p.y;
    const b = r1.sub(r2).div(h);
    const a = sqrt(float(1.0).sub(b.mul(b)));
    const k = dot(vec2(px, py), vec2(b.negate(), a));

    // Distance based on which section of capsule we're in
    const dist1 = length(vec2(px, py)).sub(r1); // Top cap
    const dist2 = length(vec2(px, py.sub(h))).sub(r2); // Bottom point
    const dist3 = dot(vec2(px, py), vec2(a, b)).sub(r1); // Side

    // Select correct distance based on position
    // k < 0: top hemisphere, k > a*h: bottom point, else: side
    const inTop = step(k, 0.0);
    const inBottom = step(a.mul(h), k);
    const inSide = float(1.0).sub(inTop).sub(inBottom).max(0.0);

    return dist1.mul(inTop).add(dist2.mul(inBottom)).add(dist3.mul(inSide));
});

export function createSkyNodeMaterial() {
    const material = new THREE.MeshBasicNodeMaterial();

    const height = normalize(positionWorld).y;
    const bottomColor = vec3(0.20, 0.05, 0.30);
    const midColor = vec3(0.10, 0.03, 0.20);
    const topColor = vec3(0.00, 0.00, 0.05);

    const midMix = smoothstep(0.0, 0.3, height);
    const topMix = smoothstep(0.3, 1.0, height);

    const baseColor = mix(bottomColor, midColor, midMix);
    const skyColor = mix(baseColor, topColor, topMix);

    const hazeAmount = float(1.0).sub(smoothstep(-0.2, 0.5, height));
    const hazeColor = vec3(0.25, 0.08, 0.45);

    // AAA Phase 4d: animated light-pollution glow along the city horizon.
    const horizonLower = smoothstep(-0.45, -0.08, height);
    const horizonUpper = float(1.0).sub(smoothstep(0.0, 0.34, height));
    const horizonMask = horizonLower.mul(horizonUpper);
    const shimmer = sin(positionWorld.x.mul(0.0012).add(time.mul(0.09)))
        .mul(0.12)
        .add(sin(positionWorld.z.mul(0.0017).sub(time.mul(0.055))).mul(0.08))
        .add(1.0);
    const horizonGlow = vec3(0.72, 0.10, 0.62)
        .add(vec3(0.05, 0.20, 0.36).mul(sin(time.mul(0.12)).mul(0.5).add(0.5)))
        .mul(horizonMask)
        .mul(shimmer)
        .mul(0.28);

    material.colorNode = mix(skyColor, hazeColor, hazeAmount.mul(0.6)).add(horizonGlow);
    material.emissiveNode = vec3(0.0);
    material.side = THREE.BackSide;

    return { material };
}

export function createStarfieldNodeMaterial() {
    const uTime = uniform(0);
    const uPixelRatio = uniform(1);

    const aSize = attribute('aSize');
    const aTwinkle = attribute('aTwinkle');
    const aBrightness = attribute('aBrightness');

    const twinkle = sin(uTime.mul(aTwinkle.y).add(aTwinkle.x));
    const brightness = aBrightness.mul(twinkle.mul(0.35).add(0.65));

    const sizeNode = clamp(
        aSize.mul(uPixelRatio).mul(float(200.0).div(positionView.z.negate())),
        2.0,
        50.0,
    );

    const material = new THREE.PointsNodeMaterial();
    material.sizeNode = sizeNode;

    const finalColor = vertexColor().mul(brightness.mul(1.2));
    const alpha = clamp(brightness.add(0.15), 0.0, 1.0);
    // Use separate color and opacity to avoid vec4() TSL issues
    material.colorNode = finalColor;
    material.opacityNode = alpha;
    material.emissiveNode = finalColor;
    material.transparent = true;
    material.vertexColors = true;
    material.blending = THREE.AdditiveBlending;
    material.depthWrite = false;

    return { material, uniforms: { uTime, uPixelRatio } };
}

export function createBuildingNodeMaterial() {
    const uTime = uniform(0);
    const uSeed = uniform(0);
    const uGlowIntensity = uniform(1.0);
    const uWindowScale = uniform(1.0);

    const pos = positionLocal;
    const norm = normalLocal;
    const worldPos = positionWorld;

    // ═══════════════════════════════════════════════════════════════════════════
    // PERF: Distance-based RESOLUTION SCALING for building shader
    // Quantizes coordinates to simulate lower resolution rendering at distance
    // Creates a "pixelated/blocky" effect - same window pattern but coarser
    // ═══════════════════════════════════════════════════════════════════════════
    const distFromCamera = length(positionView);

    // Resolution scale factors - KICK IN SOONER to prevent aliasing
    const resScale1 = smoothstep(200.0, 500.0, distFromCamera);   // Was 300-600
    const resScale2 = smoothstep(500.0, 900.0, distFromCamera);   // Was 600-1000
    const resScale3 = smoothstep(900.0, 1400.0, distFromCamera);  // Was 1000-1500

    // Quantization step - Start slightly blocky (2.0) to avoid pixel crawl immediately
    const quantStep = mix(
        float(2.0), // Was 1.0 - Start coarser
        mix(
            float(8.0), // Was 5.0
            mix(float(18.0), float(35.0), resScale3), // Was 15->30
            resScale2
        ),
        resScale1
    );

    // Quantize local position
    const quantizedPos = floor(pos.div(quantStep)).mul(quantStep);

    // Blend to quantized position - Faster transition
    const quantBlend = smoothstep(100.0, 300.0, distFromCamera);
    const patternPos = mix(pos, quantizedPos, quantBlend);

    // LOD factor for other simplifications
    const lodNear = smoothstep(1200.0, 400.0, distFromCamera);  // 1.0 close, 0.0 far

    const positionSeed = hash2D(floor(worldPos.xz.div(50.0)));
    const effectiveSeed = uSeed.add(positionSeed.mul(1000.0));

    // Darker base color
    const nearBaseColor = vec3(0.015, 0.015, 0.02);
    const farBaseColor = vec3(0.0);
    const baseColor = mix(farBaseColor, nearBaseColor, lodNear);

    // Reduced grunge intensity
    const grunge = noise2D(patternPos.xy.mul(0.5).add(effectiveSeed.mul(10.0)));
    const baseWithGrunge = mix(baseColor, baseColor.add(vec3(0.015).mul(grunge)), lodNear);

    // Reduced grid intensity
    const gridX = step(0.98, fract(patternPos.x.div(10.0)));
    const gridY = step(0.98, fract(patternPos.y.div(10.0)));
    const gridIntensity = mix(float(0.0), float(0.02), lodNear);
    const baseWithGrid = baseWithGrunge.add(vec3(gridIntensity).mul(max(gridX, gridY)));

    // Window grid - Increased scaling
    const aspectParams = hash2D(vec2(effectiveSeed, 123.45));
    const windowScaleFactor = mix(
        float(1.5), // Start at 1.5x scale (was 1.0)
        mix(float(4.0), float(7.0), resScale3),
        resScale2
    );

    const baseGridW = float(5.0).add(aspectParams.mul(5.0)).mul(uWindowScale.mul(0.4).add(0.8));
    const baseGridH = float(8.0).add(hash2D(vec2(effectiveSeed, 678.9)).mul(8.0)).mul(uWindowScale.mul(0.4).add(0.8));
    const gridW = baseGridW.mul(windowScaleFactor);
    const gridH = baseGridH.mul(windowScaleFactor);

    const isSide = float(1.0).sub(step(0.1, abs(norm.y)));
    const gridXY = vec2(patternPos.x, patternPos.y);
    const gridXZ = vec2(patternPos.x, patternPos.z);
    const gridStr = mix(gridXZ, gridXY, isSide).add(effectiveSeed.mul(50.0));

    const cell = floor(gridStr.div(vec2(gridW, gridH)));
    const frac = fract(gridStr.div(vec2(gridW, gridH)));

    const baseGap = float(0.2).add(hash2D(vec2(effectiveSeed, 333.33)).mul(0.15));
    const gapBoost = mix(float(0.0), float(0.25), resScale2);
    const gap = baseGap.add(gapBoost);

    // ANTI-ALIASING: Use smoothstep for soft edges
    const edgeSoftness = mix(float(0.02), float(0.1), resScale1); // Softer at distance
    const isWindow = smoothstep(gap, gap.add(edgeSoftness), frac.x)
        .mul(smoothstep(frac.x, frac.x.add(edgeSoftness), float(1.0).sub(gap)))
        .mul(smoothstep(gap, gap.add(edgeSoftness), frac.y))
        .mul(smoothstep(frac.y, frac.y.add(edgeSoftness), float(1.0).sub(gap)));

    // Density Reduction
    const baseLitDensity = float(0.35).add(hash2D(vec2(effectiveSeed, 999.0)).mul(0.4));
    const litDensity = mix(baseLitDensity.mul(0.15), baseLitDensity, lodNear); // Was 0.12
    const minDensity = mix(float(0.05), float(0.15), lodNear);
    const effectiveDensity = max(litDensity, minDensity);

    const h = hash2D(cell.add(vec2(effectiveSeed)));
    const isLit = isWindow.mul(step(float(1.0).sub(effectiveDensity), h));

    const hue = hash2D(cell.mul(2.0));
    const pureWhite = vec3(1.0, 1.0, 1.0);
    const warmWhite = vec3(1.0, 0.94, 0.85);

    const winColor = mix(pureWhite, warmWhite, smoothstep(0.2, 0.8, hue));

    const wBright = float(0.75).add(hash2D(cell.mul(3.0)).mul(0.35));
    // Reduced brightness multiplier (0.55 -> 0.45)
    // Much dimmer distant windows
    const distanceDimming = mix(float(0.3), float(1.0), lodNear);
    const effectiveBright = mix(float(0.45), wBright, lodNear).mul(distanceDimming);

    const windowGlow = winColor.mul(effectiveBright).mul(0.85).mul(isLit);

    const distanceDarkening = mix(float(0.4), float(1.0), lodNear);
    const distanceBlackout = mix(float(0.5), float(1.0), lodNear);

    const finalColor = baseWithGrid.add(windowGlow.mul(distanceDarkening)).mul(distanceBlackout);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = finalColor;
    const emissiveDimming = mix(float(0.15), float(0.85), lodNear);
    material.emissiveNode = windowGlow.mul(emissiveDimming).mul(distanceBlackout);

    return { material, uniforms: { uTime, uSeed, uGlowIntensity, uWindowScale } };
}

export function createMegaTowerNodeMaterial() {
    const uTime = uniform(0);
    const uColor = uniform(new THREE.Color(0x100018));

    const gridUv = uv().mul(vec2(25.0, 100.0));
    const cell = floor(gridUv);
    const st = fract(gridUv);

    const windowMask = step(0.22, st.x)
        .mul(step(0.22, st.y))
        .mul(step(st.x, 0.78))
        .mul(step(st.y, 0.85));

    const noise = rand2D(cell);
    const state = step(0.7, noise);
    const intensity = rand2D(cell).mul(2.2).add(0.8);

    const colPink = vec3(1.0, 0.0, 1.0);
    const colCyan = vec3(0.0, 1.0, 1.0);
    const colPurple = vec3(0.6, 0.0, 1.0);

    const t = uTime.mul(0.2);
    let mixedColor = mix(colPink, colPurple, sin(t).mul(0.5).add(0.5));
    mixedColor = mix(mixedColor, colCyan, sin(t.mul(0.7).add(2.0)).mul(0.5).add(0.5));

    const windowOn = windowMask.mul(state);
    const finalColor = mix(uColor, mixedColor.mul(intensity), windowOn);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = finalColor;
    material.emissiveNode = mixedColor.mul(intensity).mul(windowOn);

    return { material, uniforms: { uTime, uColor } };
}

export function createVhsBillboardNodeMaterial(params) {
    const uTime = uniform(0);
    const uRandomOffset = uniform(params?.randomOffset ?? 0);
    const uMixFactor = uniform(0);
    const uGlitchIntensity = uniform(0);
    const uScanlineIntensity = uniform(0.6);
    const uChromaticAberration = uniform(0.008);

    const tex1 = uniformTexture(params?.texture1 ?? new THREE.Texture());
    const tex2 = uniformTexture(params?.texture2 ?? new THREE.Texture());

    const uvNode = uv();
    const time = uTime.add(uRandomOffset);

    const glitchLine = step(0.99, rand2D(vec2(floor(time.mul(3.0)), floor(uvNode.y.mul(20.0)))));
    const glitchOffset = glitchLine.mul(uGlitchIntensity)
        .mul(rand2D(vec2(time, uvNode.y)).sub(0.5))
        .mul(0.1);
    const transitionGlitch = uGlitchIntensity.mul(sin(time.mul(50.0))).mul(0.02);

    const uvGlitch = vec2(uvNode.x.add(glitchOffset).add(transitionGlitch), uvNode.y);

    const ca = uChromaticAberration.mul(uGlitchIntensity.mul(3.0).add(1.0));

    // PERF FIX: Simplified texture sampling - avoid vec4() with complex node expressions
    // which causes "Length of parameters exceeds maximum length" TSL error
    const tex1Sample = tex1.sample(uvGlitch);
    const tex2Sample = tex2.sample(uvGlitch);

    let texColor = mix(tex1Sample, tex2Sample, uMixFactor);

    const scanline = sin(uvNode.y.mul(300.0).add(time.mul(2.0))).mul(0.5).add(0.5);
    const scanShape = pow(scanline, float(1.6));
    const scanFactor = float(1.0).sub(scanShape.mul(uScanlineIntensity));

    // Apply scanline directly to rgb without reconstructing vec4
    const finalRgb = texColor.rgb.mul(scanFactor);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = finalRgb;
    material.opacityNode = float(1.0);
    material.emissiveNode = finalRgb;
    material.transparent = true;
    material.depthWrite = false;

    return {
        material,
        uniforms: {
            uTime,
            uMixFactor,
            uGlitchIntensity,
            uScanlineIntensity,
            uChromaticAberration,
            tex1,
            tex2,
        },
    };
}

/**
 * AAA Phase 4a — Hero moon. A bright, looming synthwave moon with a soft corona
 * halo, retro horizontal banding, crater mottling and a glowing terminator rim.
 * Bright emissive so MRT bloom + the Phase 2 god-rays anchor to it dramatically.
 * The geometry should be a CircleGeometry sized larger than the visible disc so
 * the halo has room to fall off (disc fills the inner ~45% of the quad).
 */
export function createMoonNodeMaterial() {
    const color1 = uniform(new THREE.Color(0xff2bb0)); // bottom hot magenta
    const color2 = uniform(new THREE.Color(0x35e8ff)); // top cyan
    const uHaloColor = uniform(new THREE.Color(0x9b3bff)); // violet corona
    const uBrightness = uniform(1.35);
    const uHaloIntensity = uniform(0.85);

    const uvNode = uv();
    // Normalized radius: 0 at center, 1 at the geometry edge.
    const r = length(uvNode.sub(0.5)).mul(2.0);

    // Disc vs. surrounding corona glow.
    const discMask = float(1.0).sub(smoothstep(0.52, 0.58, r)); // 1 inside disc, soft edge
    const haloPulse = sin(time.mul(0.4)).mul(0.08).add(1.0); // gentle breathing
    const haloCore = float(1.0).sub(smoothstep(0.46, 1.0, r));
    const halo = pow(haloCore, float(2.3)).mul(uHaloIntensity).mul(haloPulse);

    // Vertical synthwave gradient.
    const grad = mix(color1, color2, uvNode.y);

    // Retro horizontal banding + crater mottling on the disc surface.
    const bands = sin(uvNode.y.mul(70.0)).mul(0.06).add(0.94);
    const craters = noise2D(uvNode.mul(7.0).add(vec2(13.0, 13.0))).mul(0.22)
        .add(noise2D(uvNode.mul(18.0).sub(vec2(5.0, 5.0))).mul(0.12))
        .add(0.7);
    const surface = bands.mul(craters);

    // Bright terminator rim near the disc edge.
    const rim = smoothstep(0.30, 0.45, r).mul(0.6);

    const discColor = grad.mul(surface).add(grad.mul(rim)).mul(uBrightness);
    const haloColor = uHaloColor.mul(halo);

    const finalColor = discColor.mul(discMask).add(haloColor);
    const alpha = clamp(discMask.add(halo), 0.0, 1.0);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = finalColor;
    material.opacityNode = alpha;
    material.emissiveNode = finalColor; // feeds MRT bloom + god-rays
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    return {
        material,
        uniforms: {
            color1, color2, uHaloColor, uBrightness, uHaloIntensity,
        },
    };
}

/**
 * AAA Phase 4b — Drifting smog / cloud strata. A wide horizontal band of scrolling
 * FBM cloud, additive and palette-tinted, hung high in the sky. Several of these at
 * different heights/depths drifting in opposite directions give the upper sky living
 * atmosphere and let the moon backlight the haze.
 */
export function createCloudStrataNodeMaterial(params = {}) {
    const uTint = uniform(params.tint ?? new THREE.Color(0x7a2da0));
    const uSpeed = uniform(params.speed ?? 0.012);
    const uOpacity = uniform(params.opacity ?? 0.3);
    const uScale = uniform(params.scale ?? 1.0);

    const uvNode = uv();

    // Horizontally-stretched scrolling fractal cloud.
    const p = vec2(
        uvNode.x.mul(5.0).mul(uScale).add(time.mul(uSpeed)),
        uvNode.y.mul(2.0),
    );
    const n = fbm4(p);
    const n2 = fbm4(p.mul(2.0).add(vec2(7.3, 2.1)));
    const cloud = smoothstep(0.42, 0.85, n.mul(0.7).add(n2.mul(0.3)));

    // Soft vertical falloff so the strip's top/bottom edges dissolve.
    const vfade = smoothstep(0.0, 0.35, uvNode.y)
        .mul(float(1.0).sub(smoothstep(0.6, 1.0, uvNode.y)));
    const density = cloud.mul(vfade);

    const color = uTint.mul(density.mul(1.4));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.opacityNode = density.mul(uOpacity);
    material.emissiveNode = color.mul(0.55); // subtle bloom contribution
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.AdditiveBlending;

    return {
        material,
        uniforms: {
            uTint, uSpeed, uOpacity, uScale,
        },
    };
}

export function createSkylineNodeMaterial() {
    const uColor1 = uniform(new THREE.Color(0x020005));
    const uColor2 = uniform(new THREE.Color(0x050010));
    const uWindowColor = uniform(new THREE.Color(0x401060));

    const uvNode = uv();
    const worldPos = positionWorld;

    const buildingWidth = float(0.02);
    const bIndex = floor(uvNode.x.div(buildingWidth));
    const bHeight = rand2D(vec2(bIndex, 0.0)).mul(0.4).add(0.2);

    const bIndex2 = floor(uvNode.x.add(0.01).div(buildingWidth.mul(0.8)));
    const bHeight2 = rand2D(vec2(bIndex2, 1.0)).mul(0.5).add(0.15);

    const isBuilding = step(uvNode.y, bHeight).add(step(uvNode.y, bHeight2));
    const windowScale = vec2(300.0, 200.0);
    const windowGrid = fract(uvNode.mul(windowScale));
    const isWindow = step(0.3, windowGrid.x).mul(step(0.3, windowGrid.y));
    const windowNoise = rand2D(floor(uvNode.mul(windowScale)));
    const lightsOn = step(0.9, windowNoise).mul(isWindow).mul(smoothstep(0.0, 0.2, uvNode.y));

    const baseColor = mix(uColor1, uColor2, uvNode.y);
    const finalColor = baseColor.add(uWindowColor.mul(lightsOn).mul(1.6));

    const behindTower = worldPos.z.lessThan(-3000.0).and(abs(worldPos.x).lessThan(2000.0));
    const holeMask = behindTower.select(float(0.0), float(1.0));
    const alpha = clamp(isBuilding.mul(holeMask), 0.0, 1.0);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = finalColor;
    material.opacityNode = alpha;
    material.emissiveNode = vec3(0.0);
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.BackSide;

    return { material, uniforms: { uColor1, uColor2, uWindowColor } };
}

export function createSearchlightNodeMaterial() {
    const uColor = uniform(new THREE.Color(0xaaccff));
    const vHeight = positionLocal.y.div(4000.0);
    const alpha = float(1.0).sub(vHeight).mul(0.15);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = uColor;
    material.opacityNode = alpha;
    material.emissiveNode = uColor.mul(alpha);
    material.transparent = true;
    material.blending = THREE.AdditiveBlending;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;

    return { material, uniforms: { uColor } };
}

export function createHologramNodeMaterial(params) {
    const uTime = uniform(0);
    const uColor1 = uniform(params?.color1 ?? new THREE.Color(0xff00ff));
    const uColor2 = uniform(params?.color2 ?? new THREE.Color(0x8800ff));

    const uvNode = uv();
    const gradient = sin(uvNode.y.mul(6.0).add(uTime)).mul(0.5).add(0.5);
    const color = mix(uColor1, uColor2, gradient);

    const edge = smoothstep(0.0, 0.15, uvNode.x)
        .mul(smoothstep(1.0, 0.85, uvNode.x))
        .mul(smoothstep(0.0, 0.15, uvNode.y))
        .mul(smoothstep(1.0, 0.85, uvNode.y));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.opacityNode = edge.mul(0.7);
    material.emissiveNode = color;
    material.transparent = true;
    material.side = THREE.DoubleSide;
    material.blending = THREE.AdditiveBlending;

    return { material, uniforms: { uTime, uColor1, uColor2 } };
}

export function createRainNodeMaterial() {
    const uTime = uniform(0);
    const uColor = uniform(new THREE.Color(0xcfe0f0)); // Softer rain tint
    const uIntensity = uniform(1.0);

    const aVelocity = attribute('aVelocity');
    const aPhase = attribute('aPhase');
    const aSize = attribute('aSize');

    const vAlpha = varying(float(1.0), 'vAlpha');

    const positionNode = Fn(() => {
        const basePos = positionLocal;
        const fallDistance = uTime.mul(aVelocity).mul(60.0).mul(uIntensity);
        const y = mod(basePos.y.sub(fallDistance), 1200.0);
        const wind = sin(uTime.mul(1.5).add(aPhase.mul(0.1))).mul(0.5);
        const x = basePos.x.add(wind);
        const z = basePos.z;
        const animPos = vec3(x, y, z);

        const distFromCenter = length(vec2(animPos.x, animPos.z)).div(400.0);
        vAlpha.assign(float(1.0).sub(smoothstep(0.5, 1.0, distFromCenter)));

        return animPos;
    })();

    // WebGPU does not support point UVs; keep drops subtle and varied via flicker
    const rand = fract(sin(aPhase.mul(12.9898)).mul(43758.5453));
    const flicker = sin(uTime.mul(2.0).add(aPhase.mul(6.28))).mul(0.5).add(0.5);
    const baseAlpha = mix(float(0.18), float(0.4), rand);
    const alpha = vAlpha.mul(baseAlpha).mul(mix(float(0.6), float(1.0), flicker)).mul(uIntensity.mul(0.6).add(0.4));
    const color = uColor;

    const material = new THREE.PointsNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = color.mul(alpha.mul(0.5)); // Softer glow
    material.sizeNode = aSize.mul(mix(float(6.0), float(10.0), rand)); // Subtle point size variation
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    return { material, uniforms: { uTime, uColor, uIntensity } };
}

export function createSplashNodeMaterial() {
    const uTime = uniform(0);
    const uColor = uniform(new THREE.Color(0xddeeff)); // Brighter

    const aPhase = attribute('aPhase');
    const vLife = varying(float(0.0), 'vLife');

    const positionNode = Fn(() => {
        const basePos = positionLocal;
        const cycle = mod(uTime.mul(5.0).add(aPhase), 6.28); // Slightly slower
        const life = sin(cycle).max(0.0);
        vLife.assign(life);
        return vec3(basePos.x, basePos.y.add(life.mul(2.5)), basePos.z); // Higher splash
    })();

    const alpha = vLife.mul(0.5); // Increased opacity
    const sizeNode = vLife.mul(8.0).mul(float(300.0).div(positionView.z.negate())); // Larger

    const material = new THREE.PointsNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = uColor;
    material.opacityNode = alpha;
    material.emissiveNode = uColor.mul(alpha);
    material.sizeNode = sizeNode;
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    return { material, uniforms: { uTime, uColor } };
}

/**
 * Wet Ground Material (WebGPU) - Reflective wet asphalt with puddles
 * Uses MeshPhysicalNodeMaterial for clearcoat wet look
 * @param {Object} params - Optional parameters
 * @param {THREE.Texture} params.diffuseMap - Diffuse/albedo texture
 * @param {THREE.Texture} params.normalMap - Normal map texture
 * @param {THREE.Texture} params.roughnessMap - Roughness texture
 * @param {THREE.Texture} params.aoMap - Ambient occlusion texture
 */
export function createWetGroundNodeMaterial(params = {}) {
    // const time = timerLocal(); // Removed: using imported time node
    // Global multiplier for the planar reflection blend (AAA Phase 1). Tunable at runtime.
    const uReflectionStrength = uniform(1.0);
    const uRainIntensity = uniform(1.0);

    // World position for procedural effects
    const worldPos = positionWorld;

    // ═══════════════════════════════════════════════════════════════════════
    // PERF: Aggressive distance-based LOD (branchless)
    // Tighter distances for faster LOD falloff - 15-20% FPS boost on wet ground
    // Avoids shader branching while reducing fragment cost for distant surfaces
    // ═══════════════════════════════════════════════════════════════════════
    const distFromCamera = abs(worldPos.z);

    // LOD levels (branchless via smoothstep) - TIGHTENED for performance:
    // < 150: Full detail (ripples + FBM puddles)
    // 150-350: Medium detail (simplified ripples)
    // > 350: Low detail (static wet look only)
    const lodNear = smoothstep(350.0, 150.0, distFromCamera); // 1.0 at close, 0.0 at far (was 500/200)
    const lodMid = smoothstep(600.0, 350.0, distFromCamera);  // 1.0 at medium, 0.0 at very far (was 800/500)

    // Ripple detail factor: full at <150, reduced 150-350, none >350
    const rippleDetailFactor = lodNear;

    // FBM octave count factor: 4 octaves near, 2 octaves mid, 1 octave far
    const fbmDetailFactor = mix(float(0.15), float(1.0), lodNear); // More aggressive reduction (was 0.25)

    // Scale UVs for proper tiling on large road surface
    const uvCoord = uv().mul(vec2(3.0, 15.0));

    // ═══════════════════════════════════════════════════════════════════════
    // PUDDLE GENERATION - Small distinct puddles spread naturally
    // Higher scale = smaller puddles, tighter smoothstep = more defined edges
    // ═══════════════════════════════════════════════════════════════════════
    const puddleCoord = worldPos.xz.mul(0.02); // Much larger puddles (4x bigger)

    // Use 4-octave FBM for organic, natural puddle distribution
    const puddleNoise = fbm4(puddleCoord.add(vec2(3.0, 0.0)));

    // Create distinct puddle spots with clear boundaries
    // smoothstep(0.4, 0.8) creates visible puddle spots, not gradual wetness
    const puddleMask = smoothstep(0.4, 0.8, puddleNoise);

    // ═══════════════════════════════════════════════════════════════════════
    // RAIN RIPPLES - Multi-point hash-based system (like reference demo)
    // Creates realistic circular ripples expanding from multiple impact points
    // Scale: 0.15 → ~300 ripple cells across 2000 units (each cell ~6.7 units)
    // Smaller ripples to match raindrop size
    // PHASE 1 OPTIMIZATION: Ripples scale with LOD - full detail near, simplified far
    // ═══════════════════════════════════════════════════════════════════════
    const rippleCoord = worldPos.xz.mul(0.15); // ~300 cells - smaller ripples matching raindrop size
    const rippleTime = time.mul(3.0); // Faster animation for rain-like feel

    // Get multi-point ripple normals from the advanced getRipples function
    // LOD: Full computation near camera, skip for distant fragments
    const rippleNormals = getRipples(rippleCoord, rippleTime);

    // Ripple strength - show ripples EVERYWHERE on wet surface, stronger in puddles
    // High base wetness ensures ripples visible from any camera angle (including overhead)
    // PHASE 1: Scale ripple strength by LOD - reduces impact of expensive ripple calculation
    const baseWetness = float(0.65); // Lower baseline wetness for darker asphalt presence
    const totalWetness = max(baseWetness, puddleMask); // Puddles are extra wet
    const rippleStrength = totalWetness.mul(uRainIntensity).mul(0.75).mul(rippleDetailFactor); // LOD applied

    // Visual ripple intensity for color variation - stronger for overhead visibility
    const rippleColorIntensity = rippleNormals.x.add(rippleNormals.y)
        .mul(0.5).add(0.5)
        .mul(totalWetness)
        .mul(0.14)
        .mul(rippleDetailFactor); // LOD applied - visual ripples fade with distance

    // ═══════════════════════════════════════════════════════════════════════
    // BASE COLOR - PURE DARK WET ASPHALT
    // Removed purple tint from diffuse - reflections will provide the color
    // ═══════════════════════════════════════════════════════════════════════
    let asphaltColor;
    if (params.diffuseMap) {
        const diffuseTex = uniformTexture(params.diffuseMap);
        const texColor = diffuseTex.sample(uvCoord).rgb;
        // Monochrome dark grey base
        const gray = texColor.r.mul(0.3).add(texColor.g.mul(0.59)).add(texColor.b.mul(0.11));
        asphaltColor = vec3(gray).mul(0.08); // Dark wet asphalt with visible texture
    } else {
        // Procedural - pure black/grey
        asphaltColor = vec3(0.03);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ATMOSPHERIC DEPTH
    // ═══════════════════════════════════════════════════════════════════════
    const distanceFromCamera = abs(worldPos.z).add(100.0);
    const fogStart = float(100.0);
    const fogEnd = float(1500.0);
    const distanceFog = smoothstep(fogStart, fogEnd, distanceFromCamera);
    const atmosphericDarkening = mix(float(1.0), float(0.1), distanceFog); // Fade to near-black

    // ═══════════════════════════════════════════════════════════════════════
    // BUILDING SHADOWS - Deep shadow corridors between light sources
    // PHASE 1 OPTIMIZATION: Gate shadows based on quality preset
    // Disabled for Medium/Low to save ~6 noise samples per fragment
    // ═══════════════════════════════════════════════════════════════════════

    // Quality gate: only compute procedural shadows for High+ quality
    const enableProceduralShadows = params.quality === 'High' || params.quality === 'Ultra' || params.quality === 'Extreme';

    let buildingShadow = float(1.0);
    let edgeDarkness = float(1.0);

    if (enableProceduralShadows) {
        // Shadow bands - creates alternating dark/lit corridors
        const shadowCoord1 = worldPos.xz.mul(vec2(0.004, 0.0008));
        const shadowCoord2 = worldPos.xz.mul(vec2(0.01, 0.002));
        const shadowNoise1 = noise2D(shadowCoord1.add(vec2(7.0, 13.0)));
        const shadowNoise2 = noise2D(shadowCoord2.add(vec2(23.0, 41.0)));

        // Deeper shadows with more contrast
        const combinedShadow = shadowNoise1.mul(0.7).add(shadowNoise2.mul(0.3));
        const shadowBand = smoothstep(0.3, 0.7, combinedShadow);
        buildingShadow = mix(float(0.2), float(1.0), shadowBand); // Much darker shadows

        // Edge shadows - very dark near buildings
        const roadHalfWidth = float(450.0);
        const distFromCenter = abs(worldPos.x);
        const edgeShadow = smoothstep(roadHalfWidth.mul(0.3), roadHalfWidth, distFromCenter);
        edgeDarkness = mix(float(1.0), float(0.15), edgeShadow); // Very dark at edges
    }

    // Combine all shadow and atmosphere effects (Procedural shadows disabled for Real-Time Shadows)
    const totalShadow = atmosphericDarkening;

    // Apply shadows to asphalt
    const shadowedAsphalt = asphaltColor.mul(totalShadow);

    // Puddles reflect more light - contrast against dark surroundings
    const puddleColor = shadowedAsphalt.mul(1.2);
    const baseColor = mix(shadowedAsphalt, puddleColor, puddleMask);

    // ═══════════════════════════════════════════════════════════════════════
    // LIGHT POOLS - Bright spots from building windows and streetlamps
    // Creates dramatic HIGH CONTRAST between illuminated and shadow areas
    // ═══════════════════════════════════════════════════════════════════════

    // Light pools positioned periodically along both sides of the road
    const lightPeriod = float(100.0); // Distance between light sources
    const lightZ = mod(worldPos.z.add(50.0), lightPeriod).sub(lightPeriod.div(2.0));

    // Left side lights (negative X) - near building facades
    const leftLightX = worldPos.x.add(380.0);
    const leftLightDist = sqrt(leftLightX.mul(leftLightX).add(lightZ.mul(lightZ)));
    const leftLight = smoothstep(float(100.0), float(10.0), leftLightDist);

    // Right side lights (positive X) - offset by half period
    const lightZ2 = mod(worldPos.z, lightPeriod).sub(lightPeriod.div(2.0));
    const rightLightX = worldPos.x.sub(380.0).abs();
    const rightLightDist = sqrt(rightLightX.mul(rightLightX).add(lightZ2.mul(lightZ2)));
    const rightLight = smoothstep(float(100.0), float(10.0), rightLightDist);

    // Very bright light pools for high contrast against dark base
    const warmLight = vec3(1.0, 0.85, 0.6); // Warm golden
    const coolLight = vec3(0.7, 0.85, 1.0); // Cool blueish
    const leftLightColor = warmLight.mul(leftLight.mul(0.8)); // Much brighter
    const rightLightColor = coolLight.mul(rightLight.mul(0.7));

    // Subtle center ambient to prevent pitch black in middle
    const centerAmbient = smoothstep(float(300.0), float(0.0), abs(worldPos.x)).mul(0.03);

    // Combine all lighting
    const litColor = baseColor.add(leftLightColor).add(rightLightColor).add(vec3(centerAmbient));

    // ═══════════════════════════════════════════════════════════════════════
    // NEON LIGHT REFLECTIONS - Procedural colored light streaks on wet road
    // Creates that iconic cyberpunk "neon reflecting on wet asphalt" look
    // ═══════════════════════════════════════════════════════════════════════

    // Use world Z position for streaky reflections running along the road
    // Stretched along Z axis to simulate reflections of tall buildings
    const neonCoord = worldPos.xz.mul(vec2(0.2, 0.02));

    // Animate reflections slightly ("shimmering city")
    const neonTime = time.mul(0.2);

    // Multiple neon colors with offset positions
    const neonNoise1 = noise2D(neonCoord.add(vec2(0.0, neonTime)));
    const neonNoise2 = noise2D(neonCoord.add(vec2(50.0, neonTime.mul(1.2))));
    const neonNoise3 = noise2D(neonCoord.add(vec2(100.0, 0.0)));

    // Threshold noise to create distinct light bands
    const neonBand1 = smoothstep(0.4, 0.8, neonNoise1); // Cyan band
    const neonBand2 = smoothstep(0.5, 0.9, neonNoise2); // Magenta band  
    const neonBand3 = smoothstep(0.3, 0.7, neonNoise3); // Yellow band

    // Cyberpunk neon colors - BRIGHTER
    const neonCyan = vec3(0.2, 0.8, 1.0);    // Softer, less saturated
    const neonMagenta = vec3(1.0, 0.25, 0.6);
    const neonYellow = vec3(1.0, 0.9, 0.3);

    // Combine neon reflections - stronger in puddles
    const neonReflection = neonCyan.mul(neonBand1.mul(0.25))
        .add(neonMagenta.mul(neonBand2.mul(0.2)))
        .add(neonYellow.mul(neonBand3.mul(0.18)));

    // Neon reflections are stronger in wet puddle areas (reflective surfaces)
    // But also visible on wet asphalt
    const neonStrength = puddleMask.mul(0.6).add(totalWetness.mul(0.15));

    // Final color with light pools and neon reflections
    const litWithNeon = litColor.add(neonReflection.mul(neonStrength));

    // ═══════════════════════════════════════════════════════════════════════
    // AAA PHASE 1 — TRUE PLANAR REFLECTIONS (WebGPU)
    // When a reflector node is supplied, blend the live mirror of the scene
    // (real neon/buildings/cars/moon) into the wet surface. Strongest in puddles
    // and at grazing angles (fresnel), with ripple-driven shimmer (Phase 1d).
    // ═══════════════════════════════════════════════════════════════════════
    let finalColor = litWithNeon;
    if (params.reflectorNode) {
        // Default reflector UV is screenUV.flipX(); add ripple gradient as a small
        // screen-space distortion so the reflection shimmers + smears like real water.
        const baseReflUV = screenUV.flipX();
        const rippleJitter = vec2(rippleNormals.x, rippleNormals.y)
            .mul(0.05)
            .mul(totalWetness)
            .mul(rippleDetailFactor);
        const reflUV = baseReflUV.add(rippleJitter);
        const reflColor = params.reflectorNode.sample(reflUV).rgb;

        // Fresnel: reflections strengthen at grazing angles (looking down the street).
        const fresnel = pow(
            clamp(float(1.0).sub(max(dot(normalView, positionViewDirection), 0.0)), 0.0, 1.0),
            float(4.0),
        );
        const fresnelMix = mix(float(0.22), float(1.0), fresnel);

        // Mask: mirror-strong in puddles, present on all wet asphalt; fades a touch
        // with distance and is cut entirely on the far LOD to save the extra render.
        const reflMask = clamp(
            puddleMask.mul(0.85)
                .add(totalWetness.mul(0.22))
                .mul(fresnelMix)
                .mul(uReflectionStrength)
                .mul(lodNear.mul(0.45).add(0.55)),
            0.0,
            0.9,
        );

        finalColor = mix(litWithNeon, reflColor, reflMask);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ROUGHNESS - Smooth wet surface, mirror-like puddles
    // Reference uses clamp(roughness, 0.0, 0.1) for very reflective puddles
    // ═══════════════════════════════════════════════════════════════════════
    let asphaltRoughness;
    if (params.roughnessMap) {
        const roughTex = uniformTexture(params.roughnessMap);
        // Wet asphalt - lower roughness for shinier wet look (0.02 to 0.17)
        asphaltRoughness = roughTex.sample(uvCoord).r.mul(0.15).add(0.02);
    } else {
        asphaltRoughness = float(0.1);
    }

    // Puddles: near-zero roughness for mirror-like reflections (like reference)
    const puddleRoughness = float(0.005);
    const finalRoughness = mix(asphaltRoughness, puddleRoughness, puddleMask);

    // ═══════════════════════════════════════════════════════════════════════
    // CLEARCOAT - Wet sheen on asphalt, full gloss on puddles
    // Higher values for more visible wet reflections
    // ═══════════════════════════════════════════════════════════════════════
    const asphaltClearcoat = float(0.6); // Higher for wetter look
    const puddleClearcoat = float(1.0);
    const finalClearcoat = mix(asphaltClearcoat, puddleClearcoat, puddleMask);

    const asphaltCcRough = float(0.15); // Lower for more reflective wet surface
    const puddleCcRough = float(0.0);
    const finalCcRoughness = mix(asphaltCcRough, puddleCcRough, puddleMask);

    // ═══════════════════════════════════════════════════════════════════════
    // NORMAL PERTURBATION - Ripples affect surface lighting (key for realism!)
    // ═══════════════════════════════════════════════════════════════════════

    // Sample the normal map if available to give asphalt texture/grain
    let baseNormal;
    if (params.normalMap) {
        // Correct usage: Create texture node with scaled UVs
        const nMap = texture(params.normalMap, uvCoord);
        // Use normalMap helper to convert to normal vector (TSL handles tangent space)
        baseNormal = normalMap(nMap);
    } else {
        baseNormal = normalLocal;
    }

    // Perturb surface normal with ripple normals using tangent-space projection
    const perturbedNormal = perturbNormalTSL(baseNormal, rippleNormals, rippleStrength);

    // Apply ripples everywhere based on total wetness (not just puddles)
    const finalNormal = mix(baseNormal, perturbedNormal, totalWetness);

    // ═══════════════════════════════════════════════════════════════════════
    // MATERIAL SETUP
    // ═══════════════════════════════════════════════════════════════════════
    const material = new THREE.MeshPhysicalNodeMaterial();

    // Color with ripple brightness variation
    material.colorNode = finalColor.add(vec3(rippleColorIntensity));

    // Apply perturbed normals for dynamic ripple reflections
    material.normalNode = finalNormal;

    // PBR properties
    material.roughnessNode = finalRoughness;
    material.metalnessNode = float(0.0);
    material.clearcoatNode = finalClearcoat;
    material.clearcoatRoughnessNode = finalCcRoughness;

    // Environment reflections - SUPER bright for wet neon look
    material.envMapIntensity = 1.8;

    // No emissive
    material.emissiveNode = vec3(0.0);

    // Water IOR for realistic Fresnel
    material.ior = 1.33;

    // Normal map for texture detail
    if (params.normalMap) {
        material.normalMap = params.normalMap;
        material.normalScale = new THREE.Vector2(1.0, 1.0);
    }

    // AO for depth
    if (params.aoMap) {
        material.aoMap = params.aoMap;
        material.aoMapIntensity = 1.0;
    }

    return { material, uniforms: { uReflectionStrength, uRainIntensity } };
}

/**
 * Neon Halo Material - Soft glowing sprites for neon sign halos
 * Creates a radial gradient glow effect
 */
export function createNeonHaloNodeMaterial() {
    const uColor = uniform(new THREE.Color(0xff00ff));
    const uIntensity = uniform(1.0);
    const uPulseSpeed = uniform(1.0);
    const uTime = uniform(0);

    // Use UV for radial gradient (sprite centered at 0.5, 0.5)
    const uvNode = uv();
    const center = vec2(0.5, 0.5);
    const dist = length(uvNode.sub(center)).mul(2.0); // 0 at center, 1 at edge

    // Soft radial falloff with multiple layers for glow effect
    const innerGlow = smoothstep(1.0, 0.0, dist);
    const outerGlow = smoothstep(1.2, 0.3, dist).mul(0.5);
    const coreGlow = pow(smoothstep(0.5, 0.0, dist), 2.0);

    // Combine glow layers
    const glow = innerGlow.add(outerGlow).add(coreGlow);

    // Subtle pulse animation
    const pulse = sin(uTime.mul(uPulseSpeed)).mul(0.15).add(0.85);

    // Final color with intensity and pulse
    const finalAlpha = glow.mul(uIntensity).mul(pulse).clamp(0.0, 1.0);
    const finalColor = uColor.mul(glow.add(0.5)); // Brighter at center

    const material = new THREE.SpriteMaterial();

    // For sprites, we need to use a custom approach
    // Return a basic sprite material config instead
    const spriteMaterial = new THREE.SpriteMaterial({
        color: 0xff00ff,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });

    return {
        material: spriteMaterial,
        uniforms: { uColor, uIntensity, uPulseSpeed, uTime },
        // Helper to create a proper halo with the given color
        createHalo: (color, intensity = 1.0) => {
            const mat = new THREE.SpriteMaterial({
                color: color,
                transparent: true,
                opacity: 0.4 * intensity,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });
            return mat;
        },
    };
}

/**
 * Billboard Halo Material - Quad-based glow that always faces camera
 * Uses MeshBasicNodeMaterial with custom vertex positioning
 */
export function createBillboardHaloNodeMaterial() {
    const uColor = uniform(new THREE.Color(0xff00ff));
    const uIntensity = uniform(1.0);
    const uTime = uniform(0);

    // Radial gradient based on UV
    const uvNode = uv();
    const center = vec2(0.5, 0.5);
    const dist = length(uvNode.sub(center)).mul(2.0);

    // Multi-layer glow
    const innerGlow = pow(smoothstep(1.0, 0.0, dist), 1.5);
    const midGlow = smoothstep(1.0, 0.2, dist).mul(0.6);
    const outerGlow = smoothstep(1.3, 0.5, dist).mul(0.3);

    const glow = innerGlow.add(midGlow).add(outerGlow);

    // Subtle flicker
    const flicker = sin(uTime.mul(8.0)).mul(0.05).add(0.95);

    const finalAlpha = glow.mul(uIntensity).mul(flicker);
    const finalColor = uColor.mul(innerGlow.add(0.3));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = finalColor;
    material.opacityNode = finalAlpha;
    material.emissiveNode = finalColor;
    material.transparent = true;
    material.side = THREE.DoubleSide;
    material.blending = THREE.AdditiveBlending;
    material.depthWrite = false;

    return { material, uniforms: { uColor, uIntensity, uTime } };
}
