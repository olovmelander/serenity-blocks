/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * NIMBUS VEIL SHADERS - Three.js GLSL Shaders
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Ethereal cloud-based visual atmosphere with:
 * - Volumetric cloud plane shaders with soft fbm noise
 * - Floating dust particle shaders with twinkle
 * - Glow sprite shaders for cloud cores
 * - Pulse wave shaders for combo/lock effects
 * - Background star shaders
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// Cloud Plane Shader - Soft volumetric-looking clouds using noise
// ─────────────────────────────────────────────────────────────────────────────

export const cloudVertexShader = /* glsl */`
varying vec2 vUv;
varying vec3 vWorldPos;

void main() {
    vUv = uv;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

export const cloudFragmentShader = /* glsl */`
uniform float uTime;
uniform float uOpacity;
uniform vec3 uColor;
uniform float uNoiseScale;
uniform float uSoftness;

varying vec2 vUv;
varying vec3 vWorldPos;

// Simplex-like noise functions
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    
    vec3 i  = floor(v + dot(v, C.yyy));
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

// Fractional Brownian Motion
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

void main() {
    vec2 centered = vUv - 0.5;
    float dist = length(centered);
    
    // Soft circular falloff
    float circleFalloff = 1.0 - smoothstep(0.0, 0.5, dist);
    
    // Multi-octave noise for cloud texture
    vec3 noisePos = vec3(vUv * uNoiseScale, uTime * 0.05);
    float cloudNoise = fbm(noisePos, 5);
    cloudNoise = cloudNoise * 0.5 + 0.5; // Normalize to 0-1
    
    // Secondary flowing noise layer
    vec3 flowPos = vec3(vUv * uNoiseScale * 0.7 + uTime * 0.02, uTime * 0.03);
    float flowNoise = fbm(flowPos, 3);
    flowNoise = flowNoise * 0.5 + 0.5;
    
    // Combine noises
    float combinedNoise = cloudNoise * 0.7 + flowNoise * 0.3;
    
    // Apply softness
    float cloudShape = smoothstep(0.2 - uSoftness * 0.2, 0.8 + uSoftness * 0.2, combinedNoise);
    
    // Final alpha with circular falloff
    float alpha = circleFalloff * cloudShape * uOpacity;
    
    // Slight brightness variation
    vec3 finalColor = uColor * (0.9 + cloudNoise * 0.2);
    
    gl_FragColor = vec4(finalColor, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Dust Particle Shader - Floating luminescent particles
// ─────────────────────────────────────────────────────────────────────────────

export const dustVertexShader = /* glsl */`
uniform float uTime;
uniform float uSize;
uniform float uIntensity;

attribute float aRandom;
attribute float aPhase;

varying float vAlpha;
varying float vRandom;

void main() {
    vRandom = aRandom;
    
    // Twinkle effect
    float twinkle = sin(uTime * 2.0 + aPhase * 6.28) * 0.5 + 0.5;
    vAlpha = (0.3 + twinkle * 0.7) * uIntensity;
    
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    
    // Size attenuation with distance
    float sizeAtten = (200.0 / -mvPosition.z);
    gl_PointSize = uSize * (0.5 + aRandom * 0.5) * sizeAtten;
}
`;

export const dustFragmentShader = /* glsl */`
varying float vAlpha;
varying float vRandom;

void main() {
    // Soft circular point
    vec2 center = gl_PointCoord - 0.5;
    float dist = length(center);
    float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
    
    // Slight color variation
    vec3 color = vec3(0.95, 0.97, 1.0) * (0.9 + vRandom * 0.2);
    
    gl_FragColor = vec4(color, alpha * vAlpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Background Stars Shader
// ─────────────────────────────────────────────────────────────────────────────

export const starsVertexShader = /* glsl */`
uniform float uTime;
uniform float uSize;

attribute float aRandom;

varying float vAlpha;

void main() {
    // Subtle twinkle
    float twinkle = sin(uTime * 1.5 + aRandom * 10.0) * 0.3 + 0.7;
    vAlpha = twinkle * (0.3 + aRandom * 0.7);
    
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    
    // Distant stars are smaller
    float sizeAtten = (150.0 / -mvPosition.z);
    gl_PointSize = uSize * (0.3 + aRandom * 0.7) * sizeAtten;
}
`;

export const starsFragmentShader = /* glsl */`
varying float vAlpha;

void main() {
    vec2 center = gl_PointCoord - 0.5;
    float dist = length(center);
    
    // Sharp core with soft halo
    float core = 1.0 - smoothstep(0.0, 0.2, dist);
    float halo = 1.0 - smoothstep(0.0, 0.5, dist);
    float alpha = core * 0.8 + halo * 0.2;
    
    gl_FragColor = vec4(vec3(0.9, 0.92, 1.0), alpha * vAlpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Pulse Wave Shader - Expanding ethereal rings for effects
// ─────────────────────────────────────────────────────────────────────────────

export const pulseVertexShader = /* glsl */`
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const pulseFragmentShader = /* glsl */`
uniform float uTime;
uniform float uProgress;
uniform float uOpacity;
uniform vec3 uColor;

varying vec2 vUv;

void main() {
    vec2 centered = vUv - 0.5;
    float dist = length(centered);
    
    // Ring shape that expands with progress
    float ringRadius = uProgress * 0.5;
    float ringWidth = 0.05 * (1.0 - uProgress * 0.5);
    
    float ring = 1.0 - smoothstep(ringRadius - ringWidth, ringRadius, dist);
    ring *= smoothstep(ringRadius + ringWidth * 2.0, ringRadius + ringWidth, dist);
    
    // Fade with progress
    float fade = 1.0 - uProgress;
    
    // Soft glow around ring
    float glow = 1.0 - smoothstep(0.0, ringRadius + 0.1, dist);
    glow *= 0.3 * fade;
    
    float alpha = (ring + glow) * uOpacity * fade;
    
    gl_FragColor = vec4(uColor, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Mist/Fog Sprite Shader - Soft ambient atmosphere
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
uniform float uOpacity;

varying vec2 vUv;

// Simple noise
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
    vec2 centered = vUv - 0.5;
    float dist = length(centered);
    
    // Very soft radial falloff
    float falloff = 1.0 - smoothstep(0.0, 0.5, dist);
    falloff = falloff * falloff; // Extra soft
    
    // Flowing noise
    float n = noise(vUv * 3.0 + uTime * 0.1);
    n = n * 0.3 + 0.7;
    
    float alpha = falloff * uOpacity * n;
    
    gl_FragColor = vec4(vec3(0.95, 0.96, 1.0), alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Lock Effect - Heavenly Light Burst Shader
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

varying vec2 vUv;

void main() {
    vec2 centered = vUv - 0.5;
    float dist = length(centered);
    
    // Expanding soft glow
    float expandRadius = uProgress * 0.6;
    float glow = 1.0 - smoothstep(0.0, expandRadius + 0.2, dist);
    
    // Core brightness
    float core = 1.0 - smoothstep(0.0, expandRadius * 0.3, dist);
    core *= (1.0 - uProgress);
    
    // Rays
    float angle = atan(centered.y, centered.x);
    float rays = sin(angle * 8.0 + uProgress * 3.14159) * 0.5 + 0.5;
    rays *= glow * 0.3;
    
    float alpha = (glow * 0.6 + core * 0.8 + rays) * uIntensity * (1.0 - uProgress * 0.7);
    
    gl_FragColor = vec4(vec3(1.0, 0.98, 0.95), alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Sparkle Particle Shader - For combo effects
// ─────────────────────────────────────────────────────────────────────────────

export const sparkleVertexShader = /* glsl */`
uniform float uTime;

attribute float aLife;
attribute float aRandom;
attribute vec3 aVelocity;

varying float vAlpha;
varying float vRandom;

void main() {
    vRandom = aRandom;
    
    // Fade out with life
    vAlpha = aLife * (0.5 + sin(uTime * 10.0 + aRandom * 6.28) * 0.5);
    
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    
    gl_PointSize = (3.0 + aRandom * 4.0) * aLife * (100.0 / -mvPosition.z);
}
`;

export const sparkleFragmentShader = /* glsl */`
varying float vAlpha;
varying float vRandom;

void main() {
    vec2 center = gl_PointCoord - 0.5;
    float dist = length(center);
    
    // Star shape
    float angle = atan(center.y, center.x);
    float star = sin(angle * 4.0) * 0.3 + 0.7;
    
    float alpha = (1.0 - smoothstep(0.0, 0.4 * star, dist)) * vAlpha;
    
    vec3 color = mix(vec3(1.0, 0.98, 0.9), vec3(0.9, 0.95, 1.0), vRandom);
    
    gl_FragColor = vec4(color, alpha);
}
`;
