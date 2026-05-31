/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MOONRISE SUMMIT - GLSL Shader Library
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * AAA cinematic alpine moonrise. Adapted liberally from the Misty Lake theme
 * (proven, ships-today) with a Moonrise-distinct palette, anamorphic streak,
 * sharper alpine silhouettes, and Switch-title-screen focal-moon framing.
 *
 * Conventions:
 * - All meshes render through standard ShaderMaterial — works on both
 *   WebGLRenderer and WebGPURenderer (auto-compiled to WGSL).
 * - Single gl_FragColor output channel everywhere (no MRT traps).
 * - Additive blending on emissive layers (moon disc/streak/halo, stars,
 *   shooting stars, aurora, god rays).
 * - Normal alpha blending on mist + clouds.
 */

// ────────────────────────────────────────────────────────────────────────────
// Shared noise & utility GLSL
// ────────────────────────────────────────────────────────────────────────────

const noiseCommon = /* glsl */`
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
        i.z + vec4(0.0, i1.z, i2.z, 1.0))
        + i.y + vec4(0.0, i1.y, i2.y, 1.0))
        + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

float fbm(vec3 p, int octaves) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    for (int i = 0; i < 6; i++) {
        if (i >= octaves) break;
        value += amplitude * snoise(p * frequency);
        amplitude *= 0.5;
        frequency *= 2.0;
    }
    return value;
}

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}
`;

// ────────────────────────────────────────────────────────────────────────────
// Sky (PlaneGeometry, large backdrop)
// ────────────────────────────────────────────────────────────────────────────

export const skyVertexShader = /* glsl */`
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const skyFragmentShader = /* glsl */`
uniform vec3 uZenithColor;
uniform vec3 uMidColor;
uniform vec3 uHorizonColor;
uniform vec3 uWarmGlow;
uniform float uWarmStrength;
uniform float uTime;
uniform float uHorizonShift;

varying vec2 vUv;

${noiseCommon}

void main() {
    float y = vUv.y;

    // Multi-stop vertical gradient: horizon (y=0) → mid (y=0.5) → zenith (y=1)
    vec3 color;
    if (y > 0.62) {
        color = mix(uMidColor, uZenithColor, smoothstep(0.62, 1.0, y));
    } else if (y > 0.28) {
        color = mix(uHorizonColor, uMidColor, smoothstep(0.28, 0.62, y));
    } else {
        color = uHorizonColor;
    }

    // Warm dusk horizon glow band — peaks at y ≈ 0.16, fades up to 0.40
    float horizonBand = smoothstep(0.0, 0.16, y) * smoothstep(0.42, 0.16, y);
    float warmBoost = uWarmStrength + uHorizonShift * 0.65;
    color += uWarmGlow * horizonBand * warmBoost;

    // Milky Way: rotated fbm band in upper sky
    vec2 mwUv = vec2(vUv.x * 2.4 - vUv.y * 0.5, vUv.y * 1.6);
    float mwBand = smoothstep(0.3, 0.55, vUv.y) * smoothstep(0.95, 0.62, vUv.y);
    float mwNoise = fbm(vec3(mwUv * 1.6, uTime * 0.005), 4) * 0.5 + 0.5;
    float mwMask = mwBand * mwNoise;
    color += vec3(0.32, 0.42, 0.78) * mwMask * 0.18;

    // Subtle low-frequency color shift over time (breathing atmosphere)
    float noise = snoise(vec3(vUv * 3.0, uTime * 0.02)) * 0.025;
    color += vec3(noise * 0.4, noise * 0.3, noise * 0.7);

    // Procedural background stars in upper sky (sparse, sharp)
    vec2 starCell = floor(vUv * vec2(180.0, 100.0));
    vec2 starFrac = fract(vUv * vec2(180.0, 100.0));
    float starRnd = hash21(starCell);
    float starRnd2 = hash21(starCell + 17.7);
    float starSize = mix(0.025, 0.07, starRnd2);
    float starD = length(starFrac - 0.5);
    float starMask = smoothstep(starSize, 0.0, starD)
        * step(0.988, starRnd)
        * smoothstep(0.35, 0.65, vUv.y);
    float starTwinkle = sin(uTime * 2.8 + starRnd * 50.0) * 0.4 + 0.7;
    color += vec3(0.85, 0.9, 1.0) * starMask * starTwinkle * 1.8;

    gl_FragColor = vec4(color, 1.0);
}
`;

// ────────────────────────────────────────────────────────────────────────────
// Stars (Points)
// ────────────────────────────────────────────────────────────────────────────

export const starsVertexShader = /* glsl */`
uniform float uTime;
uniform float uSize;

attribute float aRandom;
attribute float aBrightness;
attribute vec3 aColor;

varying float vBrightness;
varying float vTwinkle;
varying vec3 vColor;

void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = uSize * aBrightness * (160.0 / -mvPosition.z);
    gl_PointSize = clamp(gl_PointSize, 0.6, 6.0);

    float tw1 = sin(uTime * 2.8 + aRandom * 60.0);
    float tw2 = sin(uTime * 1.5 + aRandom * 38.0 + 1.7);
    vTwinkle = (tw1 + tw2) * 0.35 + 0.7;
    vBrightness = aBrightness * 1.4;
    vColor = aColor;
}
`;

export const starsFragmentShader = /* glsl */`
varying float vBrightness;
varying float vTwinkle;
varying vec3 vColor;

void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);
    if (dist > 0.5) discard;
    float glow = 1.0 - smoothstep(0.0, 0.5, dist);
    glow = pow(glow, 1.6);
    float core = 1.0 - smoothstep(0.0, 0.15, dist);
    vec3 color = vColor * (glow + core * 0.6) * vBrightness * vTwinkle;
    gl_FragColor = vec4(color, (glow + core * 0.4) * vBrightness * vTwinkle);
}
`;

// ────────────────────────────────────────────────────────────────────────────
// Aurora ribbon (PlaneGeometry, Additive)
// ────────────────────────────────────────────────────────────────────────────

export const auroraVertexShader = /* glsl */`
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const auroraFragmentShader = /* glsl */`
uniform float uTime;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform float uIntensity;

varying vec2 vUv;

${noiseCommon}

void main() {
    vec2 uv = vUv;
    float edgeFadeX = smoothstep(0.0, 0.18, uv.x) * smoothstep(1.0, 0.82, uv.x);
    float edgeFadeY = smoothstep(0.0, 0.18, uv.y) * smoothstep(1.0, 0.7, uv.y);
    float edgeFade = edgeFadeX * edgeFadeY;

    float wave1 = sin(uv.x * 3.2 + uTime * 0.06) * 0.3;
    float wave2 = sin(uv.x * 5.4 - uTime * 0.04 + 2.0) * 0.2;
    float y = uv.y + wave1 + wave2;

    float band1 = smoothstep(0.25, 0.45, y) * smoothstep(0.65, 0.45, y);
    float band2 = smoothstep(0.45, 0.6, y) * smoothstep(0.8, 0.6, y);
    float band3 = smoothstep(0.1, 0.25, y) * smoothstep(0.4, 0.25, y);

    float noise = fbm(vec3(uv.x * 5.0, uv.y * 3.0, uTime * 0.08), 4) * 0.5 + 0.5;
    float aurora = (band1 + band2 * 0.6 + band3 * 0.4) * noise;

    float streamers = snoise(vec3(uv.x * 16.0, uv.y * 2.0 + uTime * 0.1, uTime * 0.05));
    streamers = smoothstep(0.4, 0.8, streamers);
    aurora += streamers * 0.22 * band1;

    vec3 color = mix(uColor1, uColor2, uv.y + wave1 * 0.3);
    color = mix(color, uColor1 * 1.4, streamers * 0.3);

    float shimmer = snoise(vec3(uv * 12.0, uTime * 0.4)) * 0.15 + 0.85;
    aurora *= shimmer;

    float alpha = aurora * uIntensity * 0.4 * edgeFade;
    gl_FragColor = vec4(color, alpha);
}
`;

// ────────────────────────────────────────────────────────────────────────────
// Drifting cloud band (PlaneGeometry, normal alpha)
// ────────────────────────────────────────────────────────────────────────────

export const cloudVertexShader = /* glsl */`
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const cloudFragmentShader = /* glsl */`
uniform float uTime;
uniform vec3 uDarkColor;
uniform vec3 uLitColor;
uniform float uOpacity;
uniform float uScroll;
uniform float uMoonSide;

varying vec2 vUv;

${noiseCommon}

void main() {
    vec2 p = vec2(vUv.x * 2.0 + uTime * 0.018 * uScroll, vUv.y * 1.4);
    vec2 q = vec2(vUv.x * 4.5 - uTime * 0.012 * uScroll, vUv.y * 3.0);
    float n = fbm(vec3(p, 0.0), 4) * 0.55 + fbm(vec3(q, 1.0), 3) * 0.45;
    float shape = smoothstep(0.38, 0.85, n * 0.5 + 0.5);

    float vFade = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.72, vUv.y);
    float hFade = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
    float alpha = shape * vFade * hFade * uOpacity;

    float rimFactor = smoothstep(0.0, uMoonSide, vUv.x);
    vec3 color = mix(uDarkColor, uLitColor, rimFactor * 0.75);

    gl_FragColor = vec4(color, alpha);
}
`;

// ────────────────────────────────────────────────────────────────────────────
// Mountain silhouette (PlaneGeometry with fbm height + altitude rim)
// ────────────────────────────────────────────────────────────────────────────

export const mountainVertexShader = /* glsl */`
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const mountainFragmentShader = /* glsl */`
uniform vec3 uBaseColor;
uniform vec3 uTopColor;
uniform vec3 uSnowColor;
uniform vec3 uFogColor;
uniform float uFogAmount;
uniform float uLayer;
uniform float uSnowLine;
uniform float uRimStrength;
uniform float uTime;

varying vec2 vUv;

${noiseCommon}

void main() {
    vec2 uv = vUv;

    // Ridgeline: multi-octave 1D fbm + sharp Smash-style asymmetric peaks
    float offset = uLayer * 113.7;
    float h = 0.0;
    h += snoise(vec3(uv.x * 1.4 + offset, 0.0, 0.0)) * 0.36;
    h += snoise(vec3(uv.x * 2.8 + offset, 0.5, 0.0)) * 0.22;
    h += snoise(vec3(uv.x * 5.6 + offset, 1.0, 0.0)) * 0.12;
    h += snoise(vec3(uv.x * 11.0 + offset, 1.5, 0.0)) * 0.06;
    h = h * 0.5 + 0.5;
    h *= (0.42 + uLayer * 0.15);

    if (uv.y > h) discard;

    // Altitude factor along the mountain's vertical span
    float altitude = uv.y / max(h, 0.001);

    // Base color shading
    vec3 color = mix(uBaseColor, uTopColor, smoothstep(0.0, 1.0, altitude));

    // Snow caps with noisy boundary
    float noiseLine = snoise(vec3(uv.x * 6.0 + offset, 0.0, 0.0)) * 0.12;
    float snowMix = smoothstep(uSnowLine + noiseLine, uSnowLine + 0.22 + noiseLine, altitude);
    color = mix(color, uSnowColor, snowMix * uRimStrength);

    // Moon-side bright rim (warmer / brighter near right side of frame)
    float moonSide = smoothstep(0.0, 1.0, uv.x);
    color += uSnowColor * snowMix * moonSide * uRimStrength * 0.18;

    // Subtle micro-texture
    float micro = snoise(vec3(uv * 24.0, 0.0)) * 0.025;
    color += vec3(micro);

    // Atmospheric fog blend (per-layer)
    color = mix(color, uFogColor, uFogAmount);

    // Vertical fog gradient toward base (valleys haze)
    float baseFog = smoothstep(0.0, 0.35, 1.0 - altitude) * 0.25;
    color = mix(color, uFogColor, baseFog);

    gl_FragColor = vec4(color, 1.0);
}
`;

// ────────────────────────────────────────────────────────────────────────────
// Moon disc (PlaneGeometry billboard, Additive)
// ────────────────────────────────────────────────────────────────────────────

export const moonVertexShader = /* glsl */`
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const moonFragmentShader = /* glsl */`
uniform float uTime;
uniform vec3 uMoonColor;
uniform vec3 uHaloColor;
uniform float uGlowIntensity;

varying vec2 vUv;

${noiseCommon}

vec2 voronoiDist(vec2 x) {
    vec2 p = floor(x);
    vec2 f = fract(x);
    float res = 8.0;
    vec2 mr;
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 b = vec2(float(i), float(j));
            vec2 r = b - f + fract(sin(vec2(dot(p + b, vec2(127.1, 311.7)), dot(p + b, vec2(269.5, 183.3)))) * 43758.5453);
            float d = dot(r, r);
            if (d < res) { res = d; mr = r; }
        }
    }
    return mr;
}

void main() {
    vec2 uv = vUv;
    vec2 center = vec2(0.5);
    float dist = length(uv - center);

    // Moon disc with soft edge
    float moonDisc = 1.0 - smoothstep(0.18, 0.21, dist);

    // Surface texture (craters + maria)
    float surface = snoise(vec3(uv * 10.0, 0.0)) * 0.08;
    surface += snoise(vec3(uv * 25.0, 1.0)) * 0.04;
    surface += snoise(vec3(uv * 5.0, 2.0)) * 0.06;

    // Voronoi craters
    vec2 craterVor = voronoiDist(uv * 8.0);
    float craters = smoothstep(0.15, 0.0, length(craterVor)) * 0.12;
    surface -= craters;

    // Inner glow (gentle — disc itself should not over-saturate)
    float innerGlow = 1.0 - smoothstep(0.0, 0.2, dist);
    innerGlow = pow(innerGlow, 1.6);

    // Slim outer halo (the outer-halo plane handles the big glow)
    float halo = 1.0 - smoothstep(0.18, 0.30, dist);
    halo = pow(halo, 2.2) * 0.25;

    // Subtle corona ripples
    float angle = atan(uv.y - 0.5, uv.x - 0.5);
    float corona = sin(angle * 14.0 + uTime * 0.3) * 0.5 + 0.5;
    corona *= smoothstep(0.2, 0.32, dist) * smoothstep(0.42, 0.32, dist);
    corona *= 0.06;

    // Albedo: disc base × surface variation. Cap below 1.0 so additive
    // blending doesn't spike past tonemap range.
    vec3 albedo = uMoonColor * (0.85 + surface);
    vec3 color = albedo * moonDisc;
    color += uMoonColor * innerGlow * 0.18;
    color += uHaloColor * halo;
    color += uHaloColor * corona;

    // Pulse on line-clear events (gentle)
    color += uHaloColor * uGlowIntensity * 0.35 * (moonDisc + halo);

    // Subtle long-period breath
    float pulse = sin(uTime * 0.5) * 0.04 + 1.0;
    color *= pulse * 0.9;

    float alpha = max(moonDisc, halo * 0.7);
    gl_FragColor = vec4(color, alpha);
}
`;

// ────────────────────────────────────────────────────────────────────────────
// Moon anamorphic streak (PlaneGeometry billboard, Additive, Switch-style)
// ────────────────────────────────────────────────────────────────────────────

export const moonStreakVertexShader = /* glsl */`
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const moonStreakFragmentShader = /* glsl */`
uniform vec3 uColor;
uniform float uTime;
uniform float uGlowIntensity;

varying vec2 vUv;

void main() {
    float cx = vUv.x - 0.5;
    float cy = vUv.y - 0.5;
    // Wide soft horizontal × razor-thin vertical → cinematic flare bar
    float horiz = exp(-cx * cx * 6.0);
    float vert = exp(-cy * cy * 110.0);
    float intensity = horiz * vert;
    intensity *= 0.85 + sin(uTime * 0.7) * 0.15;
    intensity *= 0.32 + uGlowIntensity * 0.5;
    gl_FragColor = vec4(uColor, intensity * 0.45);
}
`;

// ────────────────────────────────────────────────────────────────────────────
// Moon outer halo (PlaneGeometry billboard, Additive)
// ────────────────────────────────────────────────────────────────────────────

export const moonHaloVertexShader = /* glsl */`
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const moonHaloFragmentShader = /* glsl */`
uniform vec3 uColor;
uniform vec3 uWarm;
uniform float uIntensity;
uniform float uGlowIntensity;
uniform float uTime;

varying vec2 vUv;

${noiseCommon}

void main() {
    vec2 centered = (vUv - 0.5) * 2.0;
    float r = length(centered);

    // Soft falloff with noise-perturbed edge for organic glow
    float noise = (snoise(vec3(centered * 2.4, uTime * 0.05))) * 0.05;
    float dist = r + noise;
    // Quartic falloff — sharp inner glow, fast fade
    float halo = pow(smoothstep(0.8, 0.0, dist), 3.5);

    float breath = sin(uTime * 0.6) * 0.05 + 1.0;
    float alpha = halo * uIntensity * breath * (1.0 + uGlowIntensity * 0.4);

    // Cool core, slightly warm rim (subtle)
    float warmth = smoothstep(0.4, 0.8, dist) * 0.3;
    vec3 tint = mix(uColor, uWarm, warmth);

    gl_FragColor = vec4(tint * 0.7, alpha * 0.5);
}
`;

// ────────────────────────────────────────────────────────────────────────────
// Lake water (PlaneGeometry, ShaderMaterial, gentle waves + moon strip)
// ────────────────────────────────────────────────────────────────────────────

export const waterVertexShader = /* glsl */`
uniform float uTime;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vElevation;

void main() {
    vUv = uv;
    vec3 pos = position;

    // 4-layer gentle wave displacement
    float wave1 = sin(pos.x * 0.14 + uTime * 0.3) * cos(pos.z * 0.09 + uTime * 0.25) * 0.45;
    float wave2 = sin(pos.x * 0.07 - uTime * 0.18) * cos(pos.z * 0.11 + uTime * 0.14) * 0.26;
    float wave3 = sin(pos.x * 0.22 + pos.z * 0.13 + uTime * 0.28) * 0.13;
    float wave4 = sin(pos.x * 0.34 - pos.z * 0.09 + uTime * 0.42) * 0.06;
    float elevation = wave1 + wave2 + wave3 + wave4;
    pos.y += elevation;
    vElevation = elevation;

    float dx = cos(pos.x * 0.14 + uTime * 0.3) * 0.14 * cos(pos.z * 0.09 + uTime * 0.25) * 0.45
             + cos(pos.x * 0.07 - uTime * 0.18) * 0.07 * cos(pos.z * 0.11 + uTime * 0.14) * 0.26;
    float dz = sin(pos.x * 0.14 + uTime * 0.3) * sin(pos.z * 0.09 + uTime * 0.25) * 0.09 * 0.45
             + sin(pos.x * 0.07 - uTime * 0.18) * sin(pos.z * 0.11 + uTime * 0.14) * 0.11 * 0.26;
    vNormal = normalize(vec3(-dx, 1.0, -dz));

    vec4 worldPos = modelMatrix * vec4(pos, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

export const waterFragmentShader = /* glsl */`
uniform float uTime;
uniform vec3 uDeepColor;
uniform vec3 uShallowColor;
uniform vec3 uMoonReflection;
uniform float uMoonGlow;
uniform float uGlowIntensity;
uniform float uRippleAmp;
uniform vec2 uMoonPosition;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vElevation;

${noiseCommon}

vec2 voronoiDist(vec2 x) {
    vec2 p = floor(x);
    vec2 f = fract(x);
    float res = 8.0;
    vec2 mr;
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 b = vec2(float(i), float(j));
            vec2 r = b - f + fract(sin(vec2(dot(p + b, vec2(127.1, 311.7)), dot(p + b, vec2(269.5, 183.3)))) * 43758.5453);
            float d = dot(r, r);
            if (d < res) { res = d; mr = r; }
        }
    }
    return mr;
}

void main() {
    vec2 uv = vUv;

    // Depth gradient: near (foreground, uv.y near 0 in lake-local) is deep,
    // far horizon (uv.y near 1) reflects sky shallow
    float depth = smoothstep(0.0, 1.0, uv.y);
    vec3 color = mix(uDeepColor, uShallowColor, depth * 0.55 + 0.15);

    // Slow color variation: currents
    float currents = snoise(vec3(uv * 1.5, uTime * 0.03)) * 0.08;
    color += vec3(currents * 0.18, currents * 0.32, currents * 0.5);

    // Caustics (voronoi)
    vec2 cUv = uv * 7.5 + uTime * 0.14;
    vec2 vor = voronoiDist(cUv);
    float caustics = 1.0 - smoothstep(0.0, 0.14, length(vor));
    caustics *= depth * 0.25;
    color += uMoonReflection * caustics * 0.18;

    // Ripple distortion
    float ripple = snoise(vec3(uv * 4.0, uTime * 0.12)) * 0.015;
    ripple += snoise(vec3(uv * 8.0, uTime * 0.1 + 50.0)) * 0.008;

    // Moon vertical reflection strip
    vec2 moonUV = uMoonPosition;
    float moonDist = abs(uv.x - moonUV.x + ripple * 2.0);
    float moonY = smoothstep(moonUV.y, 0.0, uv.y);

    float shimmer1 = snoise(vec3(uv * 12.0, uTime * 0.6)) * 0.2 + 0.8;
    float shimmer2 = snoise(vec3(uv * 25.0, uTime * 0.8)) * 0.15 + 0.85;
    float shimmer = shimmer1 * shimmer2;

    float moonRefl = exp(-moonDist * moonDist * 75.0) * moonY * shimmer;
    moonRefl *= uMoonGlow * 0.45;

    float reflHalo = exp(-moonDist * moonDist * 9.0) * moonY * 0.08;
    moonRefl += reflHalo;

    float reflColumn = exp(-moonDist * moonDist * 280.0) * moonY * 0.42;
    moonRefl = max(moonRefl, reflColumn * shimmer);

    // Event-driven ripple impulse widens the moon strip
    moonRefl += uRippleAmp * exp(-moonDist * moonDist * 18.0) * moonY * 0.18;

    color = mix(color, uMoonReflection, moonRefl * 0.55);

    // Surface sparkle field — very subtle, only in the moon-strip vicinity
    float sp1 = snoise(vec3(uv * 50.0, uTime * 0.5));
    float sp2 = snoise(vec3(uv * 80.0 + 100.0, uTime * 0.6));
    float sparkle = max(sp1, sp2);
    sparkle = smoothstep(0.88, 0.97, sparkle) * depth * 0.18;
    // Mask sparkles by proximity to moon strip
    float sparkleProximity = exp(-moonDist * moonDist * 25.0);
    color += vec3(0.85, 0.92, 1.0) * sparkle * (0.35 + sparkleProximity * 0.65);

    // Fresnel edge highlight
    float fresnel = pow(1.0 - abs(vNormal.y), 4.0);
    color += uShallowColor * fresnel * 0.14;

    // Wave crest highlights
    float crest = smoothstep(0.0, 0.3, vElevation) * 0.12;
    color += vec3(0.62, 0.74, 0.95) * crest;

    // Event glow
    color += uMoonReflection * uGlowIntensity * 0.2;

    gl_FragColor = vec4(color, 0.97);
}
`;

// ────────────────────────────────────────────────────────────────────────────
// Mist layers (PlaneGeometry, transparent)
// ────────────────────────────────────────────────────────────────────────────

export const mistVertexShader = /* glsl */`
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const mistFragmentShader = /* glsl */`
uniform float uTime;
uniform vec3 uMistColor;
uniform float uOpacity;
uniform float uScroll;

varying vec2 vUv;

${noiseCommon}

void main() {
    vec2 p1 = vec2(vUv.x * 1.6 + uTime * 0.02 * uScroll, vUv.y * 1.8 - uTime * 0.005);
    vec2 p2 = vec2(vUv.x * 3.5 - uTime * 0.015 * uScroll, vUv.y * 3.0 + uTime * 0.008);
    float n = fbm(vec3(p1, 0.0), 4) * 0.55 + fbm(vec3(p2, 1.0), 3) * 0.45;
    float shape = pow(n * 0.5 + 0.5, 1.4);

    float vFade = smoothstep(0.0, 0.55, 1.0 - vUv.y);
    float hFade = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
    float alpha = shape * vFade * hFade * uOpacity;

    gl_FragColor = vec4(uMistColor, alpha);
}
`;

// ────────────────────────────────────────────────────────────────────────────
// God rays (Ultra+, PlaneGeometry billboard, Additive)
// ────────────────────────────────────────────────────────────────────────────

export const godRayVertexShader = /* glsl */`
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const godRayFragmentShader = /* glsl */`
uniform float uTime;
uniform vec3 uRayColor;
uniform float uIntensity;

varying vec2 vUv;

${noiseCommon}

void main() {
    vec2 uv = vUv;
    vec2 dir = uv - vec2(0.5, 0.85); // rays emanate downward from upper-middle
    float angle = atan(dir.y, dir.x);
    float radial = sin(angle * 20.0 + uTime * 0.2) * 0.5 + 0.5;
    float radial2 = sin(angle * 35.0 - uTime * 0.15) * 0.5 + 0.5;
    float rays = mix(radial, radial2, 0.5);
    float dist = length(dir);
    float falloff = 1.0 - smoothstep(0.0, 0.7, dist);
    float noise = fbm(vec3(uv * 3.0, uTime * 0.05), 3) * 0.5 + 0.5;
    float alpha = rays * falloff * noise * uIntensity * 0.4;
    gl_FragColor = vec4(uRayColor, alpha);
}
`;

// ────────────────────────────────────────────────────────────────────────────
// Shooting star streak (InstancedMesh PlaneGeometry, Additive)
// ────────────────────────────────────────────────────────────────────────────

export const shootingStarVertexShader = /* glsl */`
varying vec2 vUv;
void main() {
    vUv = uv;
    // instanceMatrix is auto-injected by Three.js when USE_INSTANCING is set
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

export const shootingStarFragmentShader = /* glsl */`
uniform vec3 uColor;
varying vec2 vUv;

void main() {
    float tail = pow(1.0 - vUv.x, 2.2);
    float thickness = smoothstep(0.5, 0.0, abs(vUv.y - 0.5));
    float alpha = tail * thickness;
    gl_FragColor = vec4(uColor * 1.6, alpha);
}
`;
