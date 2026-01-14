/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  🌲 SWEDISH FOREST SHADERS 🌲
 *  Custom GLSL shaders for the Swedish Forest 3D Theme
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * A mystical Nordic forest with deep blue-green atmosphere, triangular spruce trees,
 * fireflies, god rays, forest spirits, and aurora borealis effects.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Simplex 3D Noise - Shared across multiple shaders
// ─────────────────────────────────────────────────────────────────────────────
const noiseCommon = `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
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

    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
        v += a * snoise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// TREE FOLIAGE SHADER - Triangular spruce with minimal wind sway
// ─────────────────────────────────────────────────────────────────────────────
export const treeFoliageVertexShader = `
uniform float uTime;
uniform float uSwayAmount;
uniform float uLayer;

varying vec2 vUv;
varying float vHeight;
varying float vLayer;

void main() {
    vUv = uv;
    vHeight = position.y;
    vLayer = uLayer;
    
    // Gentle wind sway
    float heightFactor = smoothstep(0.0, 1.0, (position.y + 1.0) * 0.5);
    float sway = sin(uTime * 0.5 + position.x * 0.3 + uLayer * 0.5) * uSwayAmount * heightFactor;
    
    vec3 pos = position;
    pos.x += sway;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

export const treeFoliageFragmentShader = `
uniform vec3 uTreeColor;
uniform float uGlowIntensity;
uniform float uLayer;

varying vec2 vUv;
varying float vHeight;
varying float vLayer;

void main() {
    vec3 color = uTreeColor;
    
    // Edge highlight for depth
    float edge = smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
    vec3 highlight = color * 1.15;
    color = mix(color, highlight, (1.0 - edge) * 0.3);
    
    // Magic glow during events
    vec3 glowColor = vec3(0.3, 0.9, 0.7);
    color += glowColor * uGlowIntensity * 0.2;
    
    gl_FragColor = vec4(color, 1.0);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// TREE TRUNK SHADER
// ─────────────────────────────────────────────────────────────────────────────
export const trunkVertexShader = `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const trunkFragmentShader = `
uniform vec3 uTrunkColor;
uniform float uGlowIntensity;

varying vec2 vUv;

void main() {
    vec3 color = uTrunkColor;
    color *= 0.9 + vUv.y * 0.1;
    
    // Rune glow during events
    float runeGlow = smoothstep(0.3, 0.5, vUv.y) * smoothstep(0.7, 0.5, vUv.y);
    runeGlow *= smoothstep(0.3, 0.5, vUv.x) * smoothstep(0.7, 0.5, vUv.x);
    color += vec3(0.4, 1.0, 0.8) * runeGlow * uGlowIntensity * 0.4;
    
    gl_FragColor = vec4(color, 1.0);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// FOREST FLOOR SHADER - Textured ground with moss
// ─────────────────────────────────────────────────────────────────────────────
export const groundVertexShader = `
varying vec2 vUv;
varying vec3 vWorldPos;
varying float vDepth;

void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mvPosition.z;
    
    gl_Position = projectionMatrix * mvPosition;
}
`;

export const groundFragmentShader = `
uniform float uTime;
uniform vec3 uGroundColor;
uniform vec3 uMossColor; // Acts as Sunlight/Highlight
uniform vec3 uDirtColor; // Acts as Shadow/Foreground
uniform float uGlowIntensity;
uniform vec3 uFogColor;

varying vec2 vUv;
varying vec3 vWorldPos;
varying float vDepth;

${noiseCommon}

void main() {
    // 1. Distorted UVs for painterly effect
    vec2 p = vUv * 8.0; // Scale of texture
    
    // Add some "warp" to the coordinates using low freq noise
    float warp = snoise(vec3(p * 0.5, 0.0)); 
    p += warp * 0.5;

    // 2. Large Scale Pattern (The "Blobs" / Brush strokes)
    float pattern = snoise(vec3(p, 0.0));
    
    // 3. Depth Gradient (The "Lighting")
    // Map depth to 0-1 range. 
    // Near (0) -> Depth ~10. Far (1) -> Depth ~100.
    float depthFactor = smoothstep(10.0, 90.0, vDepth);
    
    // 4. Color Mixing
    
    // Start with base ground color
    vec3 finalColor = uGroundColor;
    
    // Mix in SHADOW (Dirt Color) based on:
    // - Being near the camera (1.0 - depthFactor)
    // - Pattern noise (to break up straight lines)
    float shadowMix = (1.0 - depthFactor) * 1.2 + pattern * 0.2;
    shadowMix = clamp(shadowMix, 0.0, 1.0);
    finalColor = mix(finalColor, uDirtColor, smoothstep(0.2, 0.9, shadowMix));
    
    // Mix in SUNLIGHT (Moss Color) based on:
    // - Being far away (depthFactor)
    // - Pattern noise
    float sunMix = depthFactor * 1.2 - pattern * 0.1; 
    sunMix = clamp(sunMix, 0.0, 1.0);
    
    // Firewatch ground often looks "burned" or glowing in distance
    // We mix nicely into the golden highlight
    finalColor = mix(finalColor, uMossColor, smoothstep(0.3, 1.0, sunMix));

    // 5. Stylized Hard Edges (Optional, but adds to the "Vector Art" feel)
    // We can sharpen the transition slightly if it's too blurry
    // (Left soft for now as standard Firewatch terrain is often soft gradients)

    // 6. Atmospheric Fog integration
    // Standard fog might wash it out too much, so we do a custom blend
    // to keep the colors rich.
    
    float fogStrength = smoothstep(40.0, 150.0, vDepth);
    finalColor = mix(finalColor, uFogColor, fogStrength * 0.8); // 0.8 max fog to keep some color
    
    // 7. Event Glow
    finalColor += vec3(1.0, 0.8, 0.4) * uGlowIntensity * 0.3;

    gl_FragColor = vec4(finalColor, 1.0);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// MIST/FOG SHADER
// ─────────────────────────────────────────────────────────────────────────────
export const mistVertexShader = `
varying vec2 vUv;
varying vec3 vWorldPos;

void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

export const mistFragmentShader = `
uniform float uTime;
uniform float uDensity;
uniform vec3 uMistColor;
uniform float uIntensity;

varying vec2 vUv;
varying vec3 vWorldPos;

${noiseCommon}

void main() {
    vec3 noisePos = vec3(vUv * 2.0, uTime * 0.02);
    float mist = fbm(noisePos);
    float mistLarge = fbm(vec3(vUv * 0.8, uTime * 0.01 + 30.0));
    
    float density = (mist * 0.5 + mistLarge * 0.5) * uDensity;
    density = smoothstep(0.2, 0.7, density);
    
    float edgeFade = smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.7, vUv.y);
    density *= edgeFade * uIntensity;
    
    gl_FragColor = vec4(uMistColor, density * 0.5);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// GOD RAY SHADER
// ─────────────────────────────────────────────────────────────────────────────
export const godRayVertexShader = `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const godRayFragmentShader = `
uniform float uTime;
uniform float uOpacity;
uniform float uRayWidth;
uniform float uRayStrength;
uniform float uSeed;
uniform vec3 uRayColor;

varying vec2 vUv;

${noiseCommon}

void main() {
    float center = abs(vUv.x - 0.5);
    float core = smoothstep(uRayWidth * 0.55, 0.0, center);
    float halo = smoothstep(uRayWidth + 0.14, uRayWidth * 0.2, center);
    float beam = max(core, halo * 0.65);
    beam = pow(beam, 1.5);

    float vertFade = pow(vUv.y, 0.65);
    float sunBoost = smoothstep(0.6, 1.0, vUv.y);

    float streaks = snoise(vec3(vUv.y * 10.0 + uSeed, vUv.x * 4.0, uTime * 0.18));
    streaks = smoothstep(-0.1, 0.65, streaks);

    float breakup = snoise(vec3(vUv * vec2(2.2, 6.0) + uSeed * 2.1, uTime * 0.05));
    breakup = mix(0.75, 1.0, breakup * 0.5 + 0.5);

    float flicker = 0.85 + 0.15 * sin(uTime * 0.7 + uSeed * 6.2831);

    float alpha = beam * vertFade * streaks * breakup * uOpacity * uRayStrength * flicker;
    alpha *= 0.7 + sunBoost * 0.6;
    
    vec3 color = mix(uRayColor, vec3(1.0, 0.95, 0.8), core * (0.35 + sunBoost * 0.25));
    gl_FragColor = vec4(color, alpha * 0.75);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// FIREFLY SHADER
// ─────────────────────────────────────────────────────────────────────────────
export const fireflyVertexShader = `
uniform float uTime;
uniform float uSize;
uniform float uBoost;  // Boost from piece lock effect

attribute float aRandom;
attribute float aPhase;
attribute vec3 aVelocity;

varying float vAlpha;
varying vec3 vColor;
varying float vBoost;

void main() {
    vec3 pos = position;
    
    float t = uTime * 0.3;
    pos.x += sin(t + aPhase * 10.0) * aVelocity.x * 2.0;
    pos.y += cos(t * 0.7 + aPhase * 8.0) * aVelocity.y * 1.5;
    pos.z += sin(t * 0.5 + aPhase * 6.0) * aVelocity.z * 1.0;
    
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    
    // Size increases with boost
    float boostedSize = uSize * (1.0 + uBoost * 1.5);
    gl_PointSize = boostedSize * (180.0 / -mvPosition.z);
    gl_PointSize = clamp(gl_PointSize, 2.0, 30.0);
    
    // Each firefly has unique twinkle timing based on phase + boost
    float twinkleSpeed = 6.28 + uBoost * 12.0;  // Faster twinkle when boosted
    float pulse = sin(uTime * twinkleSpeed + aPhase * 15.0) * 0.5 + 0.5;
    
    // Sharp twinkle effect when boosted
    float twinklePow = mix(2.0, 0.5, uBoost);  // Sharper peaks when boosted
    pulse = pow(pulse, twinklePow);
    
    // Alpha boosted strongly
    vAlpha = 0.3 + pulse * 0.7 + uBoost * 0.5;
    
    // Warm amber/orange fireflies for sunset - brighter when boosted
    float hueShift = aRandom * 0.15;
    vColor = vec3(1.0, 0.7 + hueShift, 0.25 + hueShift * 0.3);
    
    vBoost = uBoost;
}
`;

export const fireflyFragmentShader = `
varying float vAlpha;
varying vec3 vColor;
varying float vBoost;

void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);
    if (dist > 0.5) discard;
    
    float glow = 1.0 - smoothstep(0.0, 0.5, dist);
    glow = pow(glow, 1.5);
    
    // Brighter, larger core when boosted
    float coreSize = 0.15 + vBoost * 0.1;
    float core = 1.0 - smoothstep(0.0, coreSize, dist);
    
    // Color intensity increases with boost
    vec3 boostedColor = vColor * (1.0 + vBoost * 0.8);
    vec3 color = boostedColor * (glow + core * (0.5 + vBoost * 1.0));
    float alpha = glow * vAlpha;
    
    gl_FragColor = vec4(color, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// STARFIELD SHADER
// ─────────────────────────────────────────────────────────────────────────────
export const starVertexShader = `
uniform float uTime;
uniform float uSize;

attribute float aRandom;
attribute float aPhase;
attribute float aBrightness;

varying float vAlpha;
varying vec3 vColor;

void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    
    gl_PointSize = uSize * aBrightness * (300.0 / -mvPosition.z);
    gl_PointSize = clamp(gl_PointSize, 0.5, 4.0);
    
    float twinkle = sin(uTime * 3.0 + aPhase * 20.0) * 0.3 + 0.7;
    twinkle *= sin(uTime * 1.7 + aPhase * 15.0) * 0.2 + 0.8;
    
    vAlpha = aBrightness * twinkle;
    
    float warmth = aRandom * 0.15;
    vColor = vec3(0.9 + warmth, 0.95 + warmth * 0.5, 1.0);
}
`;

export const starFragmentShader = `
varying float vAlpha;
varying vec3 vColor;

void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);

    if (dist > 0.5) discard;

    float core = 1.0 - smoothstep(0.0, 0.15, dist);
    float glow = 1.0 - smoothstep(0.0, 0.5, dist);
    glow = pow(glow, 2.0);

    vec3 color = vColor * (core + glow * 0.5);
    // Reduced visibility for sunset sky - stars barely visible
    float alpha = (core + glow * 0.3) * vAlpha * 0.25;

    gl_FragColor = vec4(color, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// FOREST SPIRIT SHADER
// ─────────────────────────────────────────────────────────────────────────────
export const spiritVertexShader = `
uniform float uTime;

varying vec2 vUv;
varying vec3 vPosition;

void main() {
    vUv = uv;
    vPosition = position;
    
    vec3 pos = position;
    pos.y += sin(uTime * 0.8) * 0.1;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

export const spiritFragmentShader = `
uniform float uTime;
uniform float uOpacity;
uniform vec3 uSpiritColor;

varying vec2 vUv;
varying vec3 vPosition;

${noiseCommon}

void main() {
    vec2 center = vec2(0.5);
    float dist = length(vUv - center) * 2.0;
    
    float glow = 1.0 - smoothstep(0.0, 1.0, dist);
    glow = pow(glow, 2.0);
    
    float shimmer = snoise(vec3(vUv * 5.0, uTime * 0.5)) * 0.2;
    glow += shimmer * glow;
    
    float halo = 1.0 - smoothstep(0.3, 0.8, dist);
    halo = pow(halo, 3.0);
    
    float pulse = sin(uTime * 2.0) * 0.15 + 1.0;
    glow *= pulse;
    
    vec3 color = uSpiritColor;
    color = mix(color, vec3(1.0), glow * 0.4);
    
    float alpha = (glow + halo * 0.3) * uOpacity;
    alpha = clamp(alpha, 0.0, 1.0);
    
    gl_FragColor = vec4(color, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// AURORA SHADER
// ─────────────────────────────────────────────────────────────────────────────
export const auroraVertexShader = `
varying vec2 vUv;
varying vec3 vPosition;

void main() {
    vUv = uv;
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const auroraFragmentShader = `
uniform float uTime;
uniform float uIntensity;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform float uOffset;

varying vec2 vUv;
varying vec3 vPosition;

${noiseCommon}

void main() {
    vec2 uv = vUv;
    
    float wave1 = sin(uv.x * 4.0 + uTime * 0.3 + uOffset) * 0.3;
    float wave2 = sin(uv.x * 6.0 - uTime * 0.2 + uOffset * 1.5) * 0.2;
    float wave3 = cos(uv.x * 3.0 + uTime * 0.4 + uOffset * 0.8) * 0.25;
    
    float wave = wave1 + wave2 + wave3;
    float yPos = uv.y + wave * 0.3;
    
    float band = smoothstep(0.3, 0.5, yPos) * smoothstep(0.9, 0.6, yPos);
    
    float noise = snoise(vec3(uv * 2.0, uTime * 0.15 + uOffset));
    band *= 0.7 + noise * 0.3;
    
    vec3 color = mix(uColor1, uColor2, uv.x);
    color = mix(color, uColor3, (1.0 - uv.y) * 0.5);
    
    float alpha = band * uIntensity;
    
    gl_FragColor = vec4(color, alpha * 0.5);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// SPIRIT WIND SHADER
// ─────────────────────────────────────────────────────────────────────────────
export const spiritWindVertexShader = `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const spiritWindFragmentShader = `
uniform float uTime;
uniform float uOpacity;
uniform vec3 uWindColor;
uniform float uOffset;

varying vec2 vUv;

${noiseCommon}

void main() {
    vec2 uv = vUv;
    
    float ribbon = 1.0 - abs(uv.y - 0.5) * 2.0;
    ribbon = pow(ribbon, 2.0);
    
    float hFade = smoothstep(0.0, 0.2, uv.x) * smoothstep(1.0, 0.8, uv.x);
    
    float flow = snoise(vec3(uv.x * 3.0 - uTime * 0.5 + uOffset, uv.y * 2.0, uTime * 0.2));
    flow = flow * 0.3 + 0.7;
    
    float alpha = ribbon * hFade * flow * uOpacity;
    
    vec3 color = uWindColor;
    color += vec3(0.1, 0.15, 0.1) * (1.0 - uv.x);
    
    gl_FragColor = vec4(color, alpha * 0.4);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// FALLING LEAF SHADER
// ─────────────────────────────────────────────────────────────────────────────
export const leafVertexShader = `
uniform float uTime;
uniform float uSize;

attribute float aRandom;
attribute float aPhase;
attribute vec3 aVelocity;
attribute float aRotation;

varying float vAlpha;
varying vec3 vColor;
varying float vRotation;

void main() {
    vec3 pos = position;
    
    float t = uTime;
    pos.y -= aVelocity.y * t;
    pos.x += sin(t * 2.0 + aPhase * 5.0) * aVelocity.x * 0.5;
    pos.z += cos(t * 1.5 + aPhase * 3.0) * aVelocity.z * 0.3;
    
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    
    gl_PointSize = uSize * (120.0 / -mvPosition.z);
    gl_PointSize = clamp(gl_PointSize, 3.0, 15.0);
    
    float hue = aRandom * 0.3;
    vColor = vec3(0.9 + hue * 0.1, 0.6 + hue * 0.3, 0.3);
    
    vAlpha = 1.0;
    vRotation = aRotation + t * (aRandom * 2.0 - 1.0) * 2.0;
}
`;

export const leafFragmentShader = `
varying float vAlpha;
varying vec3 vColor;
varying float vRotation;

void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    
    float s = sin(vRotation);
    float c = cos(vRotation);
    vec2 rotated = vec2(coord.x * c - coord.y * s, coord.x * s + coord.y * c);
    
    float leaf = 1.0 - smoothstep(0.0, 0.5, length(rotated * vec2(1.0, 2.0)));
    
    if (leaf < 0.1) discard;
    
    gl_FragColor = vec4(vColor, leaf * vAlpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// INSTANCED TREE FOLIAGE SHADER - For InstancedMesh optimization
// Uses per-instance attributes for color and sway variation
// ─────────────────────────────────────────────────────────────────────────────
export const instancedFoliageVertexShader = `
uniform float uTime;
uniform float uGlowIntensity;

// Per-instance attributes
attribute vec3 aInstanceColor;    // Tree layer color (darker front, lighter back)
attribute float aInstanceSway;    // Sway amount based on layer depth
attribute float aInstancePhase;   // Random phase offset for wind variation

varying vec2 vUv;
varying float vHeight;
varying vec3 vInstanceColor;
varying float vGlowIntensity;

void main() {
    vUv = uv;
    vHeight = position.y;
    vInstanceColor = aInstanceColor;
    vGlowIntensity = uGlowIntensity;
    
    // Apply instance transform first
    vec4 instancePosition = instanceMatrix * vec4(position, 1.0);
    
    // Gentle wind sway based on height and instance-specific parameters
    float heightFactor = smoothstep(0.0, 1.0, (position.y + 1.0) * 0.5);
    float sway = sin(uTime * 0.5 + instancePosition.x * 0.1 + aInstancePhase) * aInstanceSway * heightFactor;
    
    instancePosition.x += sway;
    
    gl_Position = projectionMatrix * modelViewMatrix * instancePosition;
}
`;

export const instancedFoliageFragmentShader = `
varying vec2 vUv;
varying float vHeight;
varying vec3 vInstanceColor;
varying float vGlowIntensity;

void main() {
    vec3 color = vInstanceColor;
    
    // Edge highlight for depth
    float edge = smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
    vec3 highlight = color * 1.15;
    color = mix(color, highlight, (1.0 - edge) * 0.3);
    
    // Warm glow during events (sunset amber)
    vec3 glowColor = vec3(1.0, 0.7, 0.3);
    color += glowColor * vGlowIntensity * 0.25;
    
    gl_FragColor = vec4(color, 1.0);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// INSTANCED TRUNK SHADER - For InstancedMesh optimization
// ─────────────────────────────────────────────────────────────────────────────
export const instancedTrunkVertexShader = `
attribute vec3 aInstanceColor;  // Trunk color per instance

varying vec2 vUv;
varying vec3 vInstanceColor;

void main() {
    vUv = uv;
    vInstanceColor = aInstanceColor;
    
    vec4 instancePosition = instanceMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * instancePosition;
}
`;

export const instancedTrunkFragmentShader = `
uniform float uGlowIntensity;

varying vec2 vUv;
varying vec3 vInstanceColor;

void main() {
    vec3 color = vInstanceColor;
    color *= 0.9 + vUv.y * 0.1;

    // Rune glow during events - warm orange instead of cyan
    float runeGlow = smoothstep(0.3, 0.5, vUv.y) * smoothstep(0.7, 0.5, vUv.y);
    runeGlow *= smoothstep(0.3, 0.5, vUv.x) * smoothstep(0.7, 0.5, vUv.x);
    color += vec3(1.0, 0.6, 0.3) * runeGlow * uGlowIntensity * 0.4;

    gl_FragColor = vec4(color, 1.0);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// SUN SHADER - Large glowing sun for Firewatch-style sunset
// ─────────────────────────────────────────────────────────────────────────────
export const sunVertexShader = `
varying vec2 vUv;
varying vec3 vNormal;

void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const sunFragmentShader = `
uniform float uTime;
uniform float uIntensity;
uniform vec3 uCoreColor;
uniform vec3 uCoronaColor;
uniform vec3 uEdgeColor;

varying vec2 vUv;
varying vec3 vNormal;

${noiseCommon}

void main() {
    vec2 center = vUv - 0.5;
    float dist = length(center);

    // Animated turbulence for living sun effect
    float turb = snoise(vec3(vUv * 6.0, uTime * 0.3)) * 0.08;
    turb += snoise(vec3(vUv * 12.0, -uTime * 0.2)) * 0.04;

    // Core glow - bright center
    float core = 1.0 - smoothstep(0.0, 0.25 + turb, dist);

    // Corona - mid glow
    float corona = 1.0 - smoothstep(0.1, 0.4 + turb, dist);

    // Edge glow
    float edge = 1.0 - smoothstep(0.2, 0.5, dist);

    // Combine colors with layered intensity
    vec3 color = uCoreColor * core * 2.0;
    color += uCoronaColor * corona * 1.0;
    color += uEdgeColor * edge * 0.5;

    // Subtle pulse animation
    float pulse = 1.0 + sin(uTime * 1.2) * 0.06;
    color *= pulse * uIntensity;

    // Soft alpha falloff
    float alpha = smoothstep(0.5, 0.3, dist);

    gl_FragColor = vec4(color, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// DUST MOTES SHADER - Floating particles in sunlight
// ─────────────────────────────────────────────────────────────────────────────
export const dustVertexShader = `
uniform float uTime;
uniform float uSize;

attribute float aPhase;
attribute float aRandom;

varying float vAlpha;
varying vec3 vColor;

void main() {
    vec3 pos = position;

    // Gentle floating motion
    float t = uTime * 0.2;
    pos.x += sin(t + aPhase * 10.0) * 2.0;
    pos.y += cos(t * 0.7 + aPhase * 8.0) * 1.5 + sin(t * 0.3) * 0.5;
    pos.z += sin(t * 0.5 + aPhase * 6.0) * 1.0;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    gl_PointSize = uSize * (150.0 / -mvPosition.z);
    gl_PointSize = clamp(gl_PointSize, 1.0, 8.0);

    // Twinkling effect
    float twinkle = sin(uTime * 4.0 + aPhase * 20.0) * 0.3 + 0.7;
    vAlpha = twinkle * (0.3 + aRandom * 0.4);

    // Warm golden color with slight variation
    vColor = vec3(1.0, 0.85 + aRandom * 0.1, 0.5 + aRandom * 0.2);
}
`;

export const dustFragmentShader = `
varying float vAlpha;
varying vec3 vColor;

void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);

    if (dist > 0.5) discard;

    float glow = 1.0 - smoothstep(0.0, 0.5, dist);
    glow = pow(glow, 2.0);

    gl_FragColor = vec4(vColor, glow * vAlpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// MOUNTAIN SHADER - Firewatch-style layered silhouettes with atmospheric depth
// ─────────────────────────────────────────────────────────────────────────────
export const mountainVertexShader = `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const mountainFragmentShader = `
uniform vec3 uMountainColor;
uniform vec3 uFogColor;
uniform float uFogAmount;
uniform float uLayer;
uniform float uTime;

varying vec2 vUv;

${noiseCommon}

void main() {
    vec2 uv = vUv;

    // Mountain shape using layered noise - Firewatch style jagged peaks
    float mountainHeight = 0.0;

    // Different patterns for each layer with offset for variety
    float offset = uLayer * 87.654;
    mountainHeight += snoise(vec3(uv.x * 0.8 + offset, 0.0, 0.0)) * 0.35;
    mountainHeight += snoise(vec3(uv.x * 1.8 + offset, 0.5, 0.0)) * 0.25;
    mountainHeight += snoise(vec3(uv.x * 4.0 + offset, 1.0, 0.0)) * 0.15;
    mountainHeight += snoise(vec3(uv.x * 8.0 + offset, 1.5, 0.0)) * 0.08;

    // Normalize to 0-1 range and scale to fill more of the plane
    mountainHeight = mountainHeight * 0.5 + 0.5;
    // Far mountains (layer 0) are shorter, near mountains taller
    mountainHeight *= (0.55 + uLayer * 0.25);

    // Add slight animation for heat shimmer
    float shimmer = sin(uTime * 0.4 + uv.x * 8.0) * 0.008 * (1.0 - uLayer * 0.5);
    mountainHeight += shimmer;

    // Check if we're inside the mountain silhouette
    if (uv.y > mountainHeight) discard;

    // Apply atmospheric fog based on layer depth
    vec3 color = mix(uMountainColor, uFogColor, uFogAmount);

    // Slight vertical gradient for depth on peaks
    float heightGrad = (mountainHeight - uv.y) / mountainHeight;
    color = mix(color * 0.85, color, heightGrad);

    gl_FragColor = vec4(color, 1.0);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// HAZE LAYER SHADER - Atmospheric haze between tree layers
// ─────────────────────────────────────────────────────────────────────────────
export const hazeVertexShader = `
varying vec2 vUv;
varying float vFogDepth;

void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vFogDepth = -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
}
`;

export const hazeFragmentShader = `
uniform float uTime;
uniform vec3 uHazeColor;
uniform float uDensity;

varying vec2 vUv;
varying float vFogDepth;

${noiseCommon}

void main() {
    vec2 uv = vUv;

    // Animated noise for organic haze movement
    float noise1 = snoise(vec3(uv.x * 2.0 + uTime * 0.05, uv.y * 1.5, uTime * 0.02)) * 0.5 + 0.5;
    float noise2 = snoise(vec3(uv.x * 4.0 - uTime * 0.03, uv.y * 3.0, uTime * 0.015)) * 0.5 + 0.5;

    float haze = noise1 * 0.7 + noise2 * 0.3;

    // Vertical falloff - more haze at bottom
    float verticalFade = 1.0 - smoothstep(0.0, 0.7, uv.y);

    // Horizontal variation
    float horizontalVar = 0.85 + sin(uv.x * 3.14159) * 0.15;

    float alpha = haze * verticalFade * horizontalVar * uDensity;

    // Warmer color toward bottom
    vec3 color = mix(uHazeColor, uHazeColor * 1.15, verticalFade * 0.3);

    gl_FragColor = vec4(color, alpha * 0.5);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// FOREGROUND BRANCH SHADER - Procedural silhouette branches at screen edges
// ─────────────────────────────────────────────────────────────────────────────
export const branchVertexShader = `
uniform float uTime;

varying vec2 vUv;

void main() {
    vUv = uv;

    vec3 pos = position;

    // Subtle sway animation
    float sway = sin(uTime * 0.6 + position.y * 0.3) * 0.12;
    pos.x += sway * uv.y;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

export const branchFragmentShader = `
uniform vec3 uBranchColor;
uniform float uOpacity;
uniform float uSide;
uniform float uTime;

varying vec2 vUv;

${noiseCommon}

void main() {
    vec2 uv = vUv;

    // Flip UV for right side
    if (uSide > 0.0) {
        uv.x = 1.0 - uv.x;
    }

    // Create organic branch/leaf shapes using noise
    float shape = 0.0;

    // Main diagonal branch from corner
    float diagonal = uv.x * 0.8 + uv.y * 0.5;
    float mainBranch = smoothstep(0.03, 0.0, abs(diagonal - 0.4)) * smoothstep(0.0, 0.3, uv.x);

    // Secondary branches
    float b1 = smoothstep(0.02, 0.0, abs(uv.x - 0.15 - uv.y * 0.4)) * step(0.1, uv.y) * step(uv.y, 0.6);
    float b2 = smoothstep(0.02, 0.0, abs(uv.x - 0.25 - uv.y * 0.25)) * step(0.2, uv.y) * step(uv.y, 0.5);

    // Leaf clusters using noise
    float leafNoise = snoise(vec3(uv * 6.0 + uTime * 0.05, 0.0));
    float leaves = smoothstep(0.25, 0.55, leafNoise);
    // Mask leaves to branch areas
    float leafMask = smoothstep(0.6, 0.0, uv.x) * smoothstep(0.0, 0.4, uv.y) * smoothstep(0.9, 0.5, uv.y);
    leaves *= leafMask;

    shape = max(max(mainBranch, b1), max(b2, leaves * 0.9));

    if (shape < 0.05) discard;

    gl_FragColor = vec4(uBranchColor, shape * uOpacity);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// LAKE WATER SHADER - Firewatch-style reflective water with horizontal ripples
// ─────────────────────────────────────────────────────────────────────────────
export const lakeVertexShader = `
uniform float uTime;

varying vec2 vUv;
varying vec3 vWorldPos;
varying float vDepth;

void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mvPosition.z;
    
    gl_Position = projectionMatrix * mvPosition;
}
`;

export const lakeFragmentShader = `
uniform float uTime;
uniform vec3 uWaterColorDeep;      // Deep water color (darker, near camera)
uniform vec3 uWaterColorShallow;   // Shallow/sunset reflection color (golden/orange)
uniform vec3 uSkyReflection;       // Sky color for reflection
uniform vec3 uTreeReflectionColor; // Dark tree silhouette color
uniform float uRippleIntensity;

varying vec2 vUv;
varying vec3 vWorldPos;
varying float vDepth;

${noiseCommon}

void main() {
    vec2 uv = vUv;
    
    // ═══════════════════════════════════════════════════════════════
    // 1. HORIZONTAL RIPPLE ANIMATION (Firewatch style)
    // ═══════════════════════════════════════════════════════════════
    
    // Multiple wave layers for organic movement
    float wave1 = sin(uv.y * 60.0 + uTime * 1.2) * 0.003;
    float wave2 = sin(uv.y * 35.0 - uTime * 0.8 + uv.x * 5.0) * 0.005;
    float wave3 = sin(uv.y * 90.0 + uTime * 2.0) * 0.002;
    
    // Subtle noise-based distortion
    float noiseWarp = snoise(vec3(uv.x * 3.0, uv.y * 8.0, uTime * 0.15)) * 0.008;
    
    vec2 distortedUV = uv;
    distortedUV.x += (wave1 + wave2 + wave3 + noiseWarp) * uRippleIntensity;
    
    // ═══════════════════════════════════════════════════════════════
    // 2. DEPTH-BASED COLOR GRADIENT
    // ═══════════════════════════════════════════════════════════════
    
    // Distance from shore (uv.x = 0 is shore, uv.x = 1 is deep water)
    float depthGradient = smoothstep(0.0, 0.6, uv.x);
    
    // Also consider view depth for atmospheric perspective
    float viewDepthFactor = smoothstep(20.0, 80.0, vDepth);
    
    // ═══════════════════════════════════════════════════════════════
    // 3. SUNSET SKY REFLECTION
    // ═══════════════════════════════════════════════════════════════
    
    // Reflection is strongest in distance, looking toward horizon
    float reflectionStrength = (1.0 - depthGradient) * 0.7 + 0.3;
    
    // Vertical gradient in reflection (sun higher = warmer at top of water)
    float verticalReflect = 1.0 - uv.y;
    
    // Animated sun reflection shimmer
    float sunReflect = snoise(vec3(distortedUV.x * 2.0, distortedUV.y * 15.0 - uTime * 0.5, uTime * 0.1));
    sunReflect = smoothstep(0.2, 0.8, sunReflect * 0.5 + 0.5);
    
    // ═══════════════════════════════════════════════════════════════
    // 4. TREE SILHOUETTE REFLECTIONS (Firewatch style)
    // ═══════════════════════════════════════════════════════════════
    
    // Create procedural tree reflection pattern
    // Trees are reflected from the far shore (high Y in UV)
    float treeReflectY = 1.0 - uv.y; // Flip for reflection
    
    // Procedural tree shapes using layered noise
    float treeNoise = snoise(vec3(distortedUV.x * 0.8, treeReflectY * 2.0, 0.0));
    float treeNoise2 = snoise(vec3(distortedUV.x * 2.0 + 10.0, treeReflectY * 4.0, 0.0));
    float treeNoise3 = snoise(vec3(distortedUV.x * 4.0 + 20.0, treeReflectY * 3.0, 0.0));
    
    // Combine for tree silhouette (triangular spruce shapes)
    float treeShape = treeNoise * 0.5 + treeNoise2 * 0.3 + treeNoise3 * 0.2;
    
    // Trees only appear in upper portion of water (reflection from distant shore)
    float treeMask = smoothstep(0.35, 0.65, uv.y); // Trees in middle-far distance
    treeMask *= smoothstep(0.0, 0.3, uv.x); // Fade near shore edge
    
    // Threshold for tree shape
    float treeReflection = smoothstep(0.15, 0.45, treeShape) * treeMask;
    
    // Ripple-distorted tree edges
    float rippleBreak = sin(uv.y * 80.0 + uTime * 1.5) * 0.5 + 0.5;
    treeReflection *= 0.6 + rippleBreak * 0.4;
    
    // ═══════════════════════════════════════════════════════════════
    // 5. HORIZONTAL LIGHT BANDS (Water ripple highlights)
    // ═══════════════════════════════════════════════════════════════
    
    float lightBand1 = sin(uv.y * 100.0 + uTime * 0.8) * 0.5 + 0.5;
    float lightBand2 = sin(uv.y * 70.0 - uTime * 0.5 + 1.5) * 0.5 + 0.5;
    float lightBands = lightBand1 * 0.6 + lightBand2 * 0.4;
    lightBands = smoothstep(0.5, 0.9, lightBands) * 0.15;
    
    // ═══════════════════════════════════════════════════════════════
    // 6. FINAL COLOR COMPOSITION
    // ═══════════════════════════════════════════════════════════════
    
    // Base water color (deep to shallow/reflective)
    vec3 waterBase = mix(uWaterColorShallow, uWaterColorDeep, depthGradient * 0.5);
    
    // Add sky/sun reflection
    vec3 reflectedSky = mix(uSkyReflection, uWaterColorShallow, sunReflect * 0.3);
    waterBase = mix(waterBase, reflectedSky, reflectionStrength * verticalReflect);
    
    // Add shimmer highlights
    waterBase += vec3(1.0, 0.9, 0.7) * lightBands * reflectionStrength;
    
    // Mix in tree reflections as dark silhouettes
    vec3 finalColor = mix(waterBase, uTreeReflectionColor, treeReflection * 0.7);
    
    // Atmospheric fog toward distance
    float fogFactor = smoothstep(30.0, 100.0, vDepth);
    vec3 fogColor = uSkyReflection * 0.9;
    finalColor = mix(finalColor, fogColor, fogFactor * 0.4);
    
    // Shore edge fade (soft, irregular transition to ground)
    float shoreEdgeMask = 1.0 - smoothstep(0.0, 0.25, uv.x);
    float shoreNoiseLarge = snoise(vec3(vWorldPos.x * 0.03, vWorldPos.z * 0.05, 0.0));
    float shoreNoiseDetail = snoise(vec3(vWorldPos.x * 0.09 + 12.0, vWorldPos.z * 0.12 - 6.0, 0.0));
    float shoreNoise = (shoreNoiseLarge * 0.7 + shoreNoiseDetail * 0.3) * 0.06;
    float sidePinch = smoothstep(0.2, 0.95, abs(uv.y - 0.5) * 2.0) * 0.05;
    float shoreDist = uv.x + (shoreNoise + sidePinch) * shoreEdgeMask;
    float shoreAlpha = smoothstep(0.02, 0.12, shoreDist);
    
    gl_FragColor = vec4(finalColor, shoreAlpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// LENS FLARE SHADER - Camera lens flare elements from sun
// ─────────────────────────────────────────────────────────────────────────────
export const lensFlareVertexShader = `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const lensFlareFragmentShader = `
uniform float uTime;
uniform float uOpacity;
uniform vec3 uFlareColor;
uniform float uFlareType;  // 0=circle, 1=ring, 2=hexagon, 3=streak

varying vec2 vUv;

void main() {
    vec2 center = vUv - 0.5;
    float dist = length(center);
    float angle = atan(center.y, center.x);
    
    float alpha = 0.0;
    vec3 color = uFlareColor;
    
    if (uFlareType < 0.5) {
        // Circle/orb flare
        float glow = 1.0 - smoothstep(0.0, 0.5, dist);
        glow = pow(glow, 2.0);
        alpha = glow;
        
        // Bright core
        float core = 1.0 - smoothstep(0.0, 0.15, dist);
        color = mix(color, vec3(1.0), core * 0.5);
        
    } else if (uFlareType < 1.5) {
        // Ring flare
        float ring = 1.0 - abs(dist - 0.35) * 5.0;
        ring = max(0.0, ring);
        ring = pow(ring, 1.5);
        alpha = ring;
        
    } else if (uFlareType < 2.5) {
        // Hexagon flare
        float hex = cos(angle * 3.0) * 0.1;
        float hexDist = dist + hex;
        float glow = 1.0 - smoothstep(0.2, 0.45, hexDist);
        glow *= 1.0 - smoothstep(0.0, 0.2, hexDist);
        alpha = glow * 0.8;
        
    } else {
        // Streak/anamorphic flare
        float streak = 1.0 - smoothstep(0.0, 0.5, abs(center.y) * 3.0);
        streak *= 1.0 - smoothstep(0.0, 0.5, abs(center.x));
        streak = pow(streak, 1.2);
        alpha = streak;
    }
    
    // Subtle pulse animation
    float pulse = 0.9 + sin(uTime * 1.5) * 0.1;
    alpha *= pulse * uOpacity;
    
    gl_FragColor = vec4(color, alpha);
}
`;
