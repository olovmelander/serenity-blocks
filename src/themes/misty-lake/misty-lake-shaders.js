/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * MISTY LAKE SHADERS - Enhanced Three.js GLSL Shaders
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Immersive, calming lake atmosphere with:
 * - Animated water with caustics, reflections, and lily pads
 * - Volumetric ground-hugging mist with god rays
 * - Mountain silhouettes with atmospheric perspective
 * - Glowing moon with detailed halo and god rays
 * - Firefly particles with warm golden glow
 * - Aurora borealis in the sky
 * - Reeds/cattails swaying at water's edge
 * - Occasional birds flying across
 * - Falling petals/leaves
 * - Enhanced ripple and light burst effects
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// Common Noise Functions
// ─────────────────────────────────────────────────────────────────────────────

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
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;
    
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

// Voronoi for caustics
vec2 voronoi(vec2 x) {
    vec2 p = floor(x);
    vec2 f = fract(x);
    float res = 8.0;
    vec2 mr;
    for(int j = -1; j <= 1; j++) {
        for(int i = -1; i <= 1; i++) {
            vec2 b = vec2(float(i), float(j));
            vec2 r = b - f + fract(sin(vec2(dot(p + b, vec2(127.1, 311.7)), dot(p + b, vec2(269.5, 183.3)))) * 43758.5453);
            float d = dot(r, r);
            if(d < res) {
                res = d;
                mr = r;
            }
        }
    }
    return mr;
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Enhanced Water Surface Shader with Caustics and Better Reflections
// ─────────────────────────────────────────────────────────────────────────────

export const waterVertexShader = /* glsl */`
uniform float uTime;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vElevation;

void main() {
    vUv = uv;
    
    vec3 pos = position;
    
    // Multi-layered gentle wave displacement
    float wave1 = sin(pos.x * 0.12 + uTime * 0.3) * cos(pos.z * 0.08 + uTime * 0.25) * 0.4;
    float wave2 = sin(pos.x * 0.06 - uTime * 0.2) * cos(pos.z * 0.1 + uTime * 0.15) * 0.25;
    float wave3 = sin(pos.x * 0.2 + pos.z * 0.12 + uTime * 0.28) * 0.12;
    float wave4 = sin(pos.x * 0.35 - pos.z * 0.08 + uTime * 0.4) * 0.06;
    
    float elevation = wave1 + wave2 + wave3 + wave4;
    pos.y += elevation;
    vElevation = elevation;
    
    // Calculate normal from wave displacement
    float dx = cos(pos.x * 0.12 + uTime * 0.3) * 0.12 * cos(pos.z * 0.08 + uTime * 0.25) * 0.4
             + cos(pos.x * 0.06 - uTime * 0.2) * 0.06 * cos(pos.z * 0.1 + uTime * 0.15) * 0.25;
    float dz = sin(pos.x * 0.12 + uTime * 0.3) * sin(pos.z * 0.08 + uTime * 0.25) * 0.08 * 0.4
             + sin(pos.x * 0.06 - uTime * 0.2) * sin(pos.z * 0.1 + uTime * 0.15) * 0.1 * 0.25;
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
uniform vec2 uMoonPosition;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vElevation;

${noiseCommon}

void main() {
    vec2 uv = vUv;
    
    // Depth gradient with more color variation - Deep and mysterious
    float depth = smoothstep(0.0, 1.0, uv.y); // Smoother, deeper gradient
    vec3 color = mix(uDeepColor, uShallowColor, depth * 0.5 + 0.1); // Darker overall
    
    // Add subtle color variations - deep currents
    float colorVar = snoise(vec3(uv * 1.5, uTime * 0.03)) * 0.08;
    color += vec3(colorVar * 0.2, colorVar * 0.4, colorVar * 0.6);
    
    // Animated caustics pattern
    vec2 causticsUV = uv * 8.0 + uTime * 0.15;
    vec2 vor = voronoi(causticsUV);
    float caustics = 1.0 - smoothstep(0.0, 0.15, length(vor));
    caustics *= depth * 0.4;
    color += uMoonReflection * caustics * 0.5;
    
    // Gentle ripples distortion
    float ripple = snoise(vec3(uv * 4.0, uTime * 0.12)) * 0.015;
    ripple += snoise(vec3(uv * 8.0, uTime * 0.1 + 50.0)) * 0.008;
    
    // Moon reflection - elongated shimmer with more detail
    vec2 moonUV = uMoonPosition;
    float moonDist = abs(uv.x - moonUV.x + ripple * 2.0);
    float moonY = smoothstep(moonUV.y, 0.0, uv.y);
    
    // Multi-layer shimmer for more realistic reflection
    float shimmer1 = snoise(vec3(uv * 12.0, uTime * 0.6)) * 0.2 + 0.8;
    float shimmer2 = snoise(vec3(uv * 25.0, uTime * 0.8)) * 0.15 + 0.85;
    float shimmer = shimmer1 * shimmer2;
    
    // Tighter, brighter reflection column
    float moonRefl = exp(-moonDist * moonDist * 80.0) * moonY * shimmer;
    moonRefl *= uMoonGlow * 1.2;
    
    // Very subtle secondary reflection halo
    float reflHalo = exp(-moonDist * moonDist * 10.0) * moonY * 0.15;
    moonRefl += reflHalo;

    // Add elongated reflection column
    float reflColumn = exp(-moonDist * moonDist * 300.0) * moonY * 0.8;
    moonRefl = max(moonRefl, reflColumn * shimmer);
    
    color = mix(color, uMoonReflection, moonRefl * 0.8);
    
    // Enhanced surface sparkles
    float sparkle1 = snoise(vec3(uv * 50.0, uTime * 0.5));
    float sparkle2 = snoise(vec3(uv * 80.0 + 100.0, uTime * 0.6));
    float sparkle = max(sparkle1, sparkle2);
    sparkle = smoothstep(0.82, 0.95, sparkle) * depth * 0.5;
    color += vec3(0.85, 0.9, 1.0) * sparkle;
    
    // Fresnel-like edge highlight
    float fresnel = pow(1.0 - abs(vNormal.y), 4.0);
    color += uShallowColor * fresnel * 0.25;
    
    // Subtle wave crest highlights
    float crest = smoothstep(0.0, 0.3, vElevation) * 0.2;
    color += vec3(0.6, 0.7, 0.9) * crest;
    
    // Game event glow
    color += uMoonReflection * uGlowIntensity * 0.4;
    
    gl_FragColor = vec4(color, 0.94);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Enhanced Mist Shader with Ground Fog Effect
// ─────────────────────────────────────────────────────────────────────────────

export const mistVertexShader = /* glsl */`
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const mistFragmentShader = /* glsl */`
uniform float uTime;
uniform float uDensity;
uniform vec3 uMistColor;
uniform float uSpeed;
uniform float uWind;

varying vec2 vUv;

${noiseCommon}

void main() {
    vec2 uv = vUv;
    
    // Wind-affected UV offset
    vec2 windOffset = vec2(uTime * uSpeed * uWind, 0.0);
    
    // Multi-layer flowing mist with swirling motion - Rolling effect
    float mist1 = fbm(vec3((uv + windOffset) * 1.0, uTime * 0.025), 5); // Slower base
    float mist2 = fbm(vec3((uv + windOffset * 0.8) * 0.5 + 40.0, uTime * 0.015), 4); // Rolling mid
    float mist3 = fbm(vec3((uv + windOffset * 1.5) * 2.5 + 80.0, uTime * 0.04), 3); // Fast details
    
    // Swirling tendrils
    float swirl = sin(uv.x * 2.5 + uTime * 0.15 + mist1 * 1.5) * 0.15;
    
    float density = (mist1 * 0.45 + mist2 * 0.35 + mist3 * 0.2) * uDensity;
    density = smoothstep(0.15, 0.75, density + swirl);
    
    // Ground-hugging effect - denser at bottom
    float groundFog = pow(1.0 - uv.y, 1.8) * 0.6;
    density += groundFog * uDensity * 0.6;
    
    // Vertical fade
    float vertFade = smoothstep(0.0, 0.3, uv.y) * smoothstep(1.0, 0.25, uv.y);
    density *= vertFade;
    
    // Horizontal fade at edges
    float horizFade = smoothstep(0.0, 0.12, uv.x) * smoothstep(1.0, 0.88, uv.x);
    density *= horizFade;
    
    // Slight color variation in the mist
    vec3 mistCol = uMistColor;
    mistCol += vec3(mist3 * 0.05, mist2 * 0.03, mist1 * 0.08);
    
    gl_FragColor = vec4(mistCol, density * 0.45);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// God Rays Shader - Moonlight beams cutting through mist
// ─────────────────────────────────────────────────────────────────────────────

export const godRayVertexShader = /* glsl */`
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const godRayFragmentShader = /* glsl */`
uniform float uTime;
uniform float uIntensity;
uniform vec3 uRayColor;
uniform vec2 uMoonPosition;

varying vec2 vUv;

${noiseCommon}

void main() {
    vec2 uv = vUv;
    
    // Ray direction from moon
    vec2 rayDir = normalize(uv - uMoonPosition);
    
    // Multiple ray beams
    float rays = 0.0;
    for (int i = 0; i < 5; i++) {
        float offset = float(i) * 0.15 - 0.3;
        float rayX = uMoonPosition.x + offset;
        
        // Diagonal ray shape
        float distToRay = abs(uv.x - rayX - (1.0 - uv.y) * 0.1 * (float(i) - 2.0));
        float ray = exp(-distToRay * distToRay * 80.0);
        
        // Fade based on vertical position
        ray *= smoothstep(0.0, 0.3, uv.y) * smoothstep(1.0, 0.6, uv.y);
        
        // Noise modulation
        float noise = snoise(vec3(uv * 3.0 + float(i) * 10.0, uTime * 0.05));
        ray *= 0.7 + noise * 0.3;
        
        rays += ray * (0.8 - float(i) * 0.1);
    }
    
    // Shimmer effect
    float shimmer = snoise(vec3(uv * 10.0, uTime * 0.2)) * 0.2 + 0.8;
    rays *= shimmer;
    
    float alpha = rays * uIntensity * 0.3;
    
    gl_FragColor = vec4(uRayColor, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Enhanced Mountain Silhouette Shader
// ─────────────────────────────────────────────────────────────────────────────

export const mountainVertexShader = /* glsl */`
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const mountainFragmentShader = /* glsl */`
uniform vec3 uMountainColor;
uniform vec3 uFogColor;
uniform float uFogAmount;
uniform float uLayer;
uniform float uTime;

varying vec2 vUv;

${noiseCommon}

void main() {
    vec2 uv = vUv;
    
    // Mountain shape using layered noise
    float mountainHeight = 0.0;
    
    // Different patterns for each layer
    float offset = uLayer * 100.0;
    mountainHeight += snoise(vec3(uv.x * 1.5 + offset, 0.0, 0.0)) * 0.35;
    mountainHeight += snoise(vec3(uv.x * 3.0 + offset, 0.5, 0.0)) * 0.18;
    mountainHeight += snoise(vec3(uv.x * 6.0 + offset, 1.0, 0.0)) * 0.1;
    mountainHeight += snoise(vec3(uv.x * 12.0 + offset, 1.5, 0.0)) * 0.04;
    
    mountainHeight = mountainHeight * 0.5 + 0.5;
    mountainHeight *= (0.35 + uLayer * 0.18);
    
    // Check if we're inside the mountain
    float isMountain = step(uv.y, mountainHeight);
    
    if (isMountain < 0.5) discard;
    
    // Apply atmospheric fog based on layer depth
    vec3 color = mix(uMountainColor, uFogColor, uFogAmount);
    
    // Slight vertical gradient on mountain
    float heightGrad = 1.0 - (mountainHeight - uv.y) * 2.5;
    color = mix(color, uFogColor, clamp(heightGrad * 0.35, 0.0, 0.35));
    
    // Subtle texture
    float texture = snoise(vec3(uv * 20.0, 0.0)) * 0.03;
    color += vec3(texture);
    
    gl_FragColor = vec4(color, 1.0);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Enhanced Moon Shader with Craters and Better Halo
// ─────────────────────────────────────────────────────────────────────────────

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

void main() {
    vec2 uv = vUv;
    vec2 center = vec2(0.5);
    float dist = length(uv - center);
    
    // Moon disc with soft edge
    float moonDisc = 1.0 - smoothstep(0.18, 0.21, dist);
    
    // Surface texture - craters and maria
    float surface = snoise(vec3(uv * 10.0, 0.0)) * 0.08;
    surface += snoise(vec3(uv * 25.0, 1.0)) * 0.04;
    surface += snoise(vec3(uv * 5.0, 2.0)) * 0.06;
    
    // Crater pattern
    vec2 craterVor = voronoi(uv * 8.0);
    float craters = smoothstep(0.15, 0.0, length(craterVor)) * 0.1;
    surface -= craters;
    
    // Inner bright glow
    float innerGlow = 1.0 - smoothstep(0.0, 0.22, dist);
    innerGlow = pow(innerGlow, 1.3);
    
    // Multi-layer halo
    float halo1 = 1.0 - smoothstep(0.0, 0.35, dist);
    halo1 = pow(halo1, 2.0) * 0.5;
    
    float halo2 = 1.0 - smoothstep(0.0, 0.5, dist);
    halo2 = pow(halo2, 3.0) * 0.3;
    
    float halo = halo1 + halo2;
    
    // Corona effect
    float angle = atan(uv.y - 0.5, uv.x - 0.5);
    float corona = sin(angle * 16.0 + uTime * 0.3) * 0.5 + 0.5;
    corona *= smoothstep(0.2, 0.35, dist) * smoothstep(0.5, 0.35, dist);
    corona *= 0.15;
    
    // Combine
    vec3 color = uMoonColor * moonDisc * (1.0 + surface);
    color += uMoonColor * innerGlow * 0.3;
    color += uHaloColor * halo;
    color += uHaloColor * corona;
    
    // Event glow boost
    color += uHaloColor * uGlowIntensity * 0.6 * halo;
    
    // Subtle pulsing
    float pulse = sin(uTime * 0.5) * 0.05 + 1.0;
    color *= pulse;
    
    float alpha = max(moonDisc, halo * 0.9);
    
    gl_FragColor = vec4(color, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Aurora Shader - Northern lights in the sky
// ─────────────────────────────────────────────────────────────────────────────

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
    
    // Soft edge fading - eliminates sharp rectangle edges
    float edgeFadeX = smoothstep(0.0, 0.25, uv.x) * smoothstep(1.0, 0.75, uv.x);
    float edgeFadeY = smoothstep(0.0, 0.15, uv.y) * smoothstep(1.0, 0.6, uv.y);
    float edgeFade = edgeFadeX * edgeFadeY;
    
    // Flowing curtain effect - Slower and more majestic
    float wave1 = sin(uv.x * 3.0 + uTime * 0.06) * 0.3;
    float wave2 = sin(uv.x * 5.0 - uTime * 0.04 + 2.0) * 0.2;
    float wave3 = sin(uv.x * 2.0 + uTime * 0.03) * 0.35;
    
    float y = uv.y + wave1 + wave2;
    
    // Multiple aurora bands
    float band1 = smoothstep(0.25, 0.45, y) * smoothstep(0.65, 0.45, y);
    float band2 = smoothstep(0.45, 0.6, y) * smoothstep(0.8, 0.6, y);
    float band3 = smoothstep(0.1, 0.25, y) * smoothstep(0.4, 0.25, y);
    
    // Noise modulation for organic look
    float noise = fbm(vec3(uv.x * 5.0, uv.y * 3.0, uTime * 0.08), 4);
    noise = noise * 0.5 + 0.5;
    
    float aurora = (band1 + band2 * 0.6 + band3 * 0.4) * noise;
    
    // Vertical streamers
    float streamers = snoise(vec3(uv.x * 15.0, uv.y * 2.0 + uTime * 0.1, uTime * 0.05));
    streamers = smoothstep(0.4, 0.8, streamers);
    aurora += streamers * 0.2 * band1;
    
    // Color blending
    vec3 color = mix(uColor1, uColor2, uv.y + wave3 * 0.3);
    color = mix(color, uColor1 * 1.3, streamers * 0.3);
    
    // Shimmer
    float shimmer = snoise(vec3(uv * 12.0, uTime * 0.4)) * 0.15 + 0.85;
    aurora *= shimmer;
    
    float alpha = aurora * uIntensity * 0.35 * edgeFade;
    
    gl_FragColor = vec4(color, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Stars Shader - Enhanced twinkling
// ─────────────────────────────────────────────────────────────────────────────

export const starsVertexShader = /* glsl */`
uniform float uTime;
uniform float uSize;

attribute float aRandom;
attribute float aBrightness;

varying float vBrightness;
varying float vTwinkle;
varying vec3 vColor;

void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    
    gl_PointSize = uSize * aBrightness * (120.0 / -mvPosition.z);
    gl_PointSize = clamp(gl_PointSize, 0.5, 5.0);
    
    // Complex twinkling pattern - more sparkle
    float twinkle1 = sin(uTime * 3.0 + aRandom * 60.0);
    float twinkle2 = sin(uTime * 1.8 + aRandom * 40.0 + 2.0);
    float twinkle = (twinkle1 + twinkle2) * 0.35 + 0.65;
    vTwinkle = twinkle;
    vBrightness = aBrightness * 1.2; // Brighter overall
    
    // Slight color variation - more blue/white
    vColor = mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.95, 0.9), aRandom);
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
    
    // Soft glow with bright core
    float glow = 1.0 - smoothstep(0.0, 0.5, dist);
    glow = pow(glow, 1.8);
    
    float core = 1.0 - smoothstep(0.0, 0.15, dist);
    
    vec3 color = vColor * (glow + core * 0.4) * vBrightness * vTwinkle;
    
    gl_FragColor = vec4(color, (glow + core * 0.3) * vBrightness * vTwinkle);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Enhanced Firefly Shader with Better Glow
// ─────────────────────────────────────────────────────────────────────────────

export const fireflyVertexShader = /* glsl */`
uniform float uTime;
uniform float uSize;

attribute float aRandom;
attribute float aPhase;

varying float vAlpha;
varying vec3 vColor;

void main() {
    vec3 pos = position;
    
    // More organic floating path with figure-8 patterns
    float t = uTime * 0.25;
    pos.x += sin(t + aPhase * 10.0) * 2.5 * aRandom;
    pos.y += cos(t * 0.8 + aPhase * 8.0) * 2.0 * aRandom;
    pos.z += sin(t * 0.6 + aPhase * 6.0) * 1.5 * aRandom;
    
    // Additional micro-movement
    pos.x += sin(uTime * 2.0 + aPhase * 15.0) * 0.3;
    pos.y += cos(uTime * 1.8 + aPhase * 12.0) * 0.2;
    
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    
    gl_PointSize = uSize * (180.0 / -mvPosition.z);
    gl_PointSize = clamp(gl_PointSize, 3.0, 20.0);
    
    // Organic pulsing glow with varying rhythm
    float pulse1 = sin(uTime * 2.5 + aPhase * 20.0);
    float pulse2 = sin(uTime * 1.5 + aPhase * 15.0 + 1.5);
    float pulse = (pulse1 + pulse2) * 0.25 + 0.5;
    pulse = pow(pulse, 2.5);
    vAlpha = 0.25 + pulse * 0.75;
    
    // Warm golden to amber color variation - Warmer
    vColor = mix(vec3(1.0, 0.8, 0.3), vec3(1.0, 0.6, 0.2), aRandom);
}
`;

export const fireflyFragmentShader = /* glsl */`
varying float vAlpha;
varying vec3 vColor;

void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);
    if (dist > 0.5) discard;
    
    // Multi-layer soft glowing orb
    float glow = 1.0 - smoothstep(0.0, 0.5, dist);
    glow = pow(glow, 1.3);
    
    // Bright hot core
    float core = 1.0 - smoothstep(0.0, 0.12, dist);
    
    // Outer diffuse glow
    float outer = 1.0 - smoothstep(0.0, 0.5, dist);
    outer = pow(outer, 3.0) * 0.3;
    
    vec3 color = vColor * (glow + core * 0.6);
    color += vec3(1.0, 0.98, 0.9) * core * 0.4; // White hot center
    
    float alpha = (glow + core * 0.5 + outer) * vAlpha;
    
    gl_FragColor = vec4(color, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Reeds/Cattails Shader - Swaying water plants
// ─────────────────────────────────────────────────────────────────────────────

export const reedVertexShader = /* glsl */`
uniform float uTime;
uniform float uWind;

attribute float aHeight;
attribute float aPhase;

varying float vHeight;
varying float vAlpha;

void main() {
    vec3 pos = position;
    
    // Wind sway - more at top
    float swayAmount = aHeight * aHeight;
    float sway = sin(uTime * 0.8 + aPhase * 5.0) * swayAmount * uWind * 0.15;
    sway += sin(uTime * 1.2 + aPhase * 8.0) * swayAmount * uWind * 0.08;
    
    pos.x += sway;
    pos.z += sway * 0.3;
    
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    
    vHeight = aHeight;
    
    // Fade based on distance
    vAlpha = smoothstep(200.0, 50.0, -mvPosition.z);
}
`;

export const reedFragmentShader = /* glsl */`
uniform vec3 uReedColor;
uniform vec3 uTipColor;

varying float vHeight;
varying float vAlpha;

void main() {
    // Gradient from base to tip
    vec3 color = mix(uReedColor, uTipColor, vHeight);
    
    // Slight highlight at edges
    color *= 0.9 + vHeight * 0.2;
    
    gl_FragColor = vec4(color, vAlpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Lily Pad Shader - Floating pads on water
// ─────────────────────────────────────────────────────────────────────────────

export const lilyVertexShader = /* glsl */`
uniform float uTime;

varying vec2 vUv;
varying float vWave;

void main() {
    vUv = uv;
    
    vec3 pos = position;
    
    // Gentle bobbing motion
    float wave = sin(uTime * 0.6 + position.x * 0.2) * 0.08;
    wave += cos(uTime * 0.4 + position.z * 0.15) * 0.05;
    pos.y += wave;
    vWave = wave;
    
    // Slight rotation
    float rotation = sin(uTime * 0.3) * 0.02;
    float newX = pos.x * cos(rotation) - pos.z * sin(rotation);
    float newZ = pos.x * sin(rotation) + pos.z * cos(rotation);
    pos.x = newX;
    pos.z = newZ;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

export const lilyFragmentShader = /* glsl */`
uniform vec3 uPadColor;
uniform vec3 uFlowerColor;
uniform float uTime;

varying vec2 vUv;
varying float vWave;

${noiseCommon}

void main() {
    vec2 uv = vUv;
    vec2 center = vec2(0.5);
    float dist = length(uv - center);
    
    // Pad shape with notch
    float pad = 1.0 - smoothstep(0.38, 0.42, dist);
    
    float angle = atan(uv.y - 0.5, uv.x - 0.5);
    float notch = smoothstep(-0.25, 0.0, angle) * smoothstep(0.25, 0.0, angle);
    notch *= smoothstep(0.0, 0.25, dist);
    pad *= (1.0 - notch * 0.85);
    
    // Vein pattern
    float veins = sin(angle * 14.0) * 0.5 + 0.5;
    veins *= smoothstep(0.08, 0.25, dist);
    
    vec3 color = uPadColor;
    color = mix(color, uPadColor * 0.75, veins * 0.35);
    
    // Subtle texture
    float texture = snoise(vec3(uv * 15.0, 0.0)) * 0.1;
    color += vec3(texture * 0.3, texture * 0.5, texture * 0.2);
    
    // Optional flower in center
    float flower = 1.0 - smoothstep(0.0, 0.08, dist);
    float petals = sin(angle * 7.0 + uTime * 0.1) * 0.5 + 0.5;
    flower *= (0.6 + petals * 0.4);
    color = mix(color, uFlowerColor, flower);
    
    // Highlight from wave position
    color += vec3(0.1, 0.12, 0.08) * (vWave + 0.1);
    
    if (pad < 0.1) discard;
    
    gl_FragColor = vec4(color, pad);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Falling Particles Shader - Petals/Leaves
// ─────────────────────────────────────────────────────────────────────────────

export const petalVertexShader = /* glsl */`
uniform float uTime;
uniform float uSize;

attribute float aRandom;
attribute float aPhase;
attribute vec3 aColor;

varying float vAlpha;
varying vec3 vColor;
varying float vRotation;

void main() {
    vec3 pos = position;
    
    // Falling with drift
    float fallSpeed = 0.3 + aRandom * 0.2;
    pos.y -= mod(uTime * fallSpeed + aPhase * 10.0, 40.0);
    
    // Horizontal drift
    pos.x += sin(uTime * 0.5 + aPhase * 8.0) * 3.0 * aRandom;
    pos.z += cos(uTime * 0.4 + aPhase * 6.0) * 2.0;
    
    // Wrap around
    pos.y = mod(pos.y + 20.0, 40.0) - 20.0;
    
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    
    gl_PointSize = uSize * (100.0 / -mvPosition.z);
    gl_PointSize = clamp(gl_PointSize, 2.0, 12.0);
    
    vAlpha = 0.5 + aRandom * 0.3;
    vColor = aColor;
    vRotation = uTime * (0.5 + aRandom) + aPhase * 10.0;
}
`;

export const petalFragmentShader = /* glsl */`
varying float vAlpha;
varying vec3 vColor;
varying float vRotation;

void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    
    // Rotate
    float c = cos(vRotation);
    float s = sin(vRotation);
    coord = vec2(coord.x * c - coord.y * s, coord.x * s + coord.y * c);
    
    // Petal/leaf shape
    float shape = 1.0 - smoothstep(0.0, 0.4, abs(coord.x));
    shape *= 1.0 - smoothstep(0.0, 0.3, abs(coord.y));
    
    if (shape < 0.1) discard;
    
    gl_FragColor = vec4(vColor, shape * vAlpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Bird Silhouette Shader
// ─────────────────────────────────────────────────────────────────────────────

export const birdVertexShader = /* glsl */`
uniform float uTime;

attribute float aPhase;

varying float vWingPhase;

void main() {
    vec3 pos = position;
    
    vWingPhase = sin(uTime * 8.0 + aPhase * 10.0);
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

export const birdFragmentShader = /* glsl */`
uniform vec3 uBirdColor;
uniform float uTime;

varying float vWingPhase;

void main() {
    gl_FragColor = vec4(uBirdColor, 1.0);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Tree Silhouette Shader - Dark framing trees with wind
// ─────────────────────────────────────────────────────────────────────────────

export const treeVertexShader = /* glsl */`
uniform float uTime;
uniform float uWind;

varying vec2 vUv;

void main() {
    vUv = uv;
    
    // Wind sway - more at top
    vec3 pos = position;
    float heightFactor = position.y * 0.02;
    float sway = sin(uTime * 0.4 + position.x * 0.1) * heightFactor * uWind * 0.8;
    sway += sin(uTime * 0.6 + position.z * 0.15) * heightFactor * uWind * 0.4;
    pos.x += sway;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

export const treeFragmentShader = /* glsl */`
uniform vec3 uTreeColor;
uniform vec3 uFogColor;
uniform float uFogAmount;

varying vec2 vUv;

void main() {
    vec3 color = mix(uTreeColor, uFogColor, uFogAmount * 0.6);
    
    gl_FragColor = vec4(color, 1.0);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Enhanced Ripple Effect Shader
// ─────────────────────────────────────────────────────────────────────────────

export const rippleVertexShader = /* glsl */`
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const rippleFragmentShader = /* glsl */`
uniform float uProgress;
uniform float uOpacity;
uniform vec3 uColor;

varying vec2 vUv;

void main() {
    vec2 center = vec2(0.5);
    float dist = length(vUv - center) * 2.0;
    
    // Multiple expanding rings
    float ringRadius1 = uProgress;
    float ringRadius2 = uProgress * 0.7;
    float ringRadius3 = uProgress * 0.4;
    float ringWidth = 0.06 * (1.0 - uProgress * 0.4);
    
    float ring1 = smoothstep(ringRadius1 - ringWidth, ringRadius1, dist);
    ring1 *= smoothstep(ringRadius1 + ringWidth, ringRadius1, dist);
    
    float ring2 = smoothstep(ringRadius2 - ringWidth * 0.7, ringRadius2, dist);
    ring2 *= smoothstep(ringRadius2 + ringWidth * 0.7, ringRadius2, dist);
    ring2 *= 0.6;
    
    float ring3 = smoothstep(ringRadius3 - ringWidth * 0.5, ringRadius3, dist);
    ring3 *= smoothstep(ringRadius3 + ringWidth * 0.5, ringRadius3, dist);
    ring3 *= 0.3;
    
    // Central glow
    float glow = 1.0 - smoothstep(0.0, uProgress * 0.3 + 0.1, dist);
    glow *= (1.0 - uProgress);
    glow *= 0.4;
    
    // Fade with progress
    float fade = pow(1.0 - uProgress, 1.5);
    
    float alpha = (ring1 + ring2 + ring3 + glow) * uOpacity * fade;
    
    gl_FragColor = vec4(uColor, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Enhanced Light Burst Shader
// ─────────────────────────────────────────────────────────────────────────────

export const lightBurstVertexShader = /* glsl */`
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const lightBurstFragmentShader = /* glsl */`
uniform float uProgress;
uniform float uIntensity;
uniform vec3 uColor;
uniform float uTime;

varying vec2 vUv;

${noiseCommon}

void main() {
    vec2 centered = vUv - 0.5;
    float dist = length(centered);
    float angle = atan(centered.y, centered.x);
    
    // Expanding soft glow
    float expandRadius = uProgress * 0.55;
    float glow = 1.0 - smoothstep(0.0, expandRadius + 0.25, dist);
    glow = pow(glow, 1.8);
    
    // Bright core
    float core = 1.0 - smoothstep(0.0, expandRadius * 0.15 + 0.02, dist);
    core *= (1.0 - uProgress);
    
    // Animated rays
    float rays = sin(angle * 8.0 + uProgress * 3.14159 * 2.0) * 0.5 + 0.5;
    rays *= glow * 0.3;
    rays *= snoise(vec3(centered * 5.0, uTime)) * 0.5 + 0.5;
    
    // Secondary rays
    float rays2 = sin(angle * 12.0 - uProgress * 2.0) * 0.5 + 0.5;
    rays2 *= glow * 0.15;
    
    float alpha = (glow * 0.6 + core * 0.8 + rays + rays2) * uIntensity * (1.0 - uProgress * 0.75);
    
    // Color gradient from center
    vec3 finalColor = mix(vec3(1.0, 0.98, 0.95), uColor, dist * 2.0);
    
    gl_FragColor = vec4(finalColor, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Enhanced Sky Gradient Shader with Breathing
// ─────────────────────────────────────────────────────────────────────────────

export const skyVertexShader = /* glsl */`
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const skyFragmentShader = /* glsl */`
uniform vec3 uTopColor;
uniform vec3 uMiddleColor;
uniform vec3 uHorizonColor;
uniform float uGlowIntensity;
uniform float uTime;

varying vec2 vUv;

${noiseCommon}

void main() {
    float y = vUv.y;
    
    // Multi-stop gradient with smooth transitions
    vec3 color;
    if (y > 0.6) {
        color = mix(uMiddleColor, uTopColor, (y - 0.6) * 2.5);
    } else if (y > 0.3) {
        color = mix(uHorizonColor, uMiddleColor, (y - 0.3) * 3.33);
    } else {
        color = uHorizonColor;
    }
    
    // Subtle color variation
    float noise = snoise(vec3(vUv * 3.0, uTime * 0.02)) * 0.03;
    color += vec3(noise * 0.5, noise * 0.3, noise * 0.8);
    
    // Breathing effect - subtle pulsing brightness
    float breathe = sin(uTime * 0.15) * 0.02 + 1.0;
    color *= breathe;
    
    // Event glow effect with gradient
    float glowGradient = pow(1.0 - y, 2.0);
    color += uHorizonColor * uGlowIntensity * 0.25 * glowGradient;
    
    // Vignette
    vec2 vignetteUV = vUv * 2.0 - 1.0;
    float vignette = 1.0 - dot(vignetteUV * 0.4, vignetteUV * 0.4);
    vignette = smoothstep(0.0, 1.0, vignette);
    color *= vignette * 0.3 + 0.7;
    
    gl_FragColor = vec4(color, 1.0);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Mist Burst Shader - Rising mist for combo effects
// ─────────────────────────────────────────────────────────────────────────────

export const mistBurstVertexShader = /* glsl */`
uniform float uTime;
uniform float uRise;

varying vec2 vUv;

void main() {
    vUv = uv;
    
    vec3 pos = position;
    pos.y += uRise * 12.0;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

export const mistBurstFragmentShader = /* glsl */`
uniform float uTime;
uniform float uOpacity;
uniform vec3 uColor;
uniform float uRise;

varying vec2 vUv;

${noiseCommon}

void main() {
    vec2 uv = vUv;
    
    // Turbulent mist column with swirl
    float swirl = sin(uv.y * 3.0 + uTime * 0.8) * 0.1;
    float noise = fbm(vec3((uv + vec2(swirl, 0.0)) * 2.5 + uTime * 0.6, uTime * 0.12), 5);
    noise = noise * 0.5 + 0.5;
    
    // Column shape with soft edges
    float column = 1.0 - abs(uv.x - 0.5) * 2.0;
    column = pow(column, 1.8);
    
    // Fade at top with wispy edge
    float vertFade = 1.0 - pow(uv.y, 1.5);
    
    // Combine
    float density = column * noise * vertFade * uOpacity;
    density *= (1.0 - uRise * 0.9); // Fade as it rises
    
    // Color variation
    vec3 col = uColor + vec3(noise * 0.05, noise * 0.03, noise * 0.08);
    
    gl_FragColor = vec4(col, density * 0.55);
}
`;
