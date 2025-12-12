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
uniform vec3 uMossColor;
uniform vec3 uDirtColor;
uniform float uGlowIntensity;

varying vec2 vUv;
varying vec3 vWorldPos;
varying float vDepth;

${noiseCommon}

void main() {
    vec2 uv = vUv;
    
    // Multi-layer noise for organic texture
    float noise1 = fbm(vec3(uv * 8.0, 0.0));
    float noise2 = snoise(vec3(uv * 15.0, uTime * 0.01));
    float noise3 = snoise(vec3(uv * 30.0, 0.5));
    
    vec3 color = uGroundColor;
    
    // Add moss patches
    float mossMask = smoothstep(0.3, 0.6, noise1);
    color = mix(color, uMossColor, mossMask * 0.5);
    
    // Add dirt/dark patches
    float dirtMask = smoothstep(0.5, 0.7, noise2);
    color = mix(color, uDirtColor, dirtMask * 0.35);
    
    // Fine texture detail
    color += vec3(noise3 * 0.04);
    
    // Fallen needles/debris
    float debris = snoise(vec3(uv * 50.0, 0.0));
    if (debris > 0.85) {
        color *= 0.82;
    }
    
    // Glow during events
    color += vec3(0.1, 0.2, 0.15) * uGlowIntensity * 0.25;
    
    // Fade with depth
    float fogFactor = smoothstep(5.0, 50.0, vDepth);
    vec3 fogColor = vec3(0.04, 0.10, 0.12);
    color = mix(color, fogColor, fogFactor * 0.6);
    
    gl_FragColor = vec4(color, 1.0);
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
uniform vec3 uRayColor;

varying vec2 vUv;

${noiseCommon}

void main() {
    float beam = 1.0 - abs(vUv.x - 0.5) * 2.0;
    beam = pow(beam, 2.0);
    
    float vertFade = 1.0 - vUv.y;
    vertFade = pow(vertFade, 0.8);
    
    float noise = snoise(vec3(vUv * 3.0, uTime * 0.1));
    noise = noise * 0.2 + 0.8;
    
    float alpha = beam * vertFade * noise * uOpacity;
    
    gl_FragColor = vec4(uRayColor, alpha * 0.4);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// FIREFLY SHADER
// ─────────────────────────────────────────────────────────────────────────────
export const fireflyVertexShader = `
uniform float uTime;
uniform float uSize;

attribute float aRandom;
attribute float aPhase;
attribute vec3 aVelocity;

varying float vAlpha;
varying vec3 vColor;

void main() {
    vec3 pos = position;
    
    float t = uTime * 0.3;
    pos.x += sin(t + aPhase * 10.0) * aVelocity.x * 2.0;
    pos.y += cos(t * 0.7 + aPhase * 8.0) * aVelocity.y * 1.5;
    pos.z += sin(t * 0.5 + aPhase * 6.0) * aVelocity.z * 1.0;
    
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    
    gl_PointSize = uSize * (180.0 / -mvPosition.z);
    gl_PointSize = clamp(gl_PointSize, 2.0, 20.0);
    
    float pulse = sin(uTime * 6.28 + aPhase * 15.0) * 0.5 + 0.5;
    pulse = pow(pulse, 2.0);
    vAlpha = 0.3 + pulse * 0.7;
    
    float hueShift = aRandom * 0.1;
    vColor = vec3(0.8 + hueShift, 1.0, 0.65 - hueShift);
}
`;

export const fireflyFragmentShader = `
varying float vAlpha;
varying vec3 vColor;

void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);
    if (dist > 0.5) discard;
    
    float glow = 1.0 - smoothstep(0.0, 0.5, dist);
    glow = pow(glow, 1.5);
    
    float core = 1.0 - smoothstep(0.0, 0.15, dist);
    
    vec3 color = vColor * (glow + core * 0.5);
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
    float alpha = (core + glow * 0.3) * vAlpha;
    
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
