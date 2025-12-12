/**
 * Ice Temple Theme - GLSL Shaders
 * 
 * Custom shaders for frost effects, ice pillars, aurora, and particle systems
 */

// ═══════════════════════════════════════════════════════════════════════════
// NOISE FUNCTIONS (Shared)
// ═══════════════════════════════════════════════════════════════════════════

const noiseLib = `
// Simplex 3D Noise
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

// Fractal Brownian Motion
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
`;

// ═══════════════════════════════════════════════════════════════════════════
// ICE PILLAR SHADER
// ═══════════════════════════════════════════════════════════════════════════

export const icePillarVertexShader = `
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec3 vViewDir;
varying vec3 vLocalPos;
varying float vHeight;

void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    vViewDir = normalize(cameraPosition - worldPos.xyz);
    vLocalPos = position;
    vHeight = position.y;
    
    gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

export const icePillarFragmentShader = `
uniform float uTime;
uniform float uPulseIntensity;
uniform vec3 uBaseColor;
uniform vec3 uGlowColor;
uniform vec3 uHighlightColor;

varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec3 vViewDir;
varying vec3 vLocalPos;
varying float vHeight;

${noiseLib}

void main() {
    // Fresnel rim lighting - icy edge glow
    float fresnel = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 3.0);
    
    // Internal frost patterns using noise
    float frost = fbm(vLocalPos * 2.0 + vec3(uTime * 0.05), 4);
    frost = smoothstep(-0.2, 0.6, frost);
    
    // Crystal facet highlights
    float facet = abs(dot(vNormal, vec3(0.5, 0.8, 0.3)));
    facet = pow(facet, 4.0) * 0.5;
    
    // Height-based gradient
    float heightGrad = smoothstep(-2.0, 3.0, vHeight);
    
    // Pulsing internal glow
    float pulse = 0.7 + 0.3 * sin(uTime * 1.5 + vWorldPosition.y * 0.5);
    pulse *= (1.0 + uPulseIntensity * 2.0);
    
    // Subsurface scattering approximation
    float sss = pow(max(dot(-vNormal, vViewDir), 0.0), 2.0) * 0.4;
    
    // Combine colors
    vec3 baseIce = mix(uBaseColor, uGlowColor, frost * 0.6);
    baseIce = mix(baseIce, uHighlightColor, heightGrad * 0.3);
    
    // Add fresnel rim
    vec3 color = baseIce;
    color += uGlowColor * fresnel * 0.8;
    color += uHighlightColor * facet;
    color += uGlowColor * sss;
    
    // Apply pulse
    color *= pulse;
    
    // Translucent ice alpha
    float alpha = 0.75 + fresnel * 0.2 + frost * 0.1;
    
    gl_FragColor = vec4(color, alpha);
}
`;

// ═══════════════════════════════════════════════════════════════════════════
// FROST FLOOR SHADER
// ═══════════════════════════════════════════════════════════════════════════

export const frostFloorVertexShader = `
varying vec2 vUv;
varying vec3 vWorldPosition;
varying vec3 vNormal;

void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    
    gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

export const frostFloorFragmentShader = `
uniform float uTime;
uniform float uCrackGlow;
uniform vec3 uIceColor;
uniform vec3 uCrackColor;
uniform vec3 uSnowColor;

varying vec2 vUv;
varying vec3 vWorldPosition;
varying vec3 vNormal;

${noiseLib}

// Voronoi for crack pattern
vec2 hash22(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
}

float voronoi(vec2 uv, out vec2 id) {
    vec2 gv = fract(uv) - 0.5;
    vec2 cid = floor(uv);
    
    float minDist = 100.0;
    vec2 closestId = vec2(0.0);
    
    for (float y = -1.0; y <= 1.0; y++) {
        for (float x = -1.0; x <= 1.0; x++) {
            vec2 offset = vec2(x, y);
            vec2 n = hash22(cid + offset);
            vec2 p = offset + sin(n * 6.28) * 0.5;
            float d = length(gv - p);
            if (d < minDist) {
                minDist = d;
                closestId = cid + offset;
            }
        }
    }
    id = closestId;
    return minDist;
}

void main() {
    vec2 uv = vWorldPosition.xz * 0.15;
    
    // Ice base color with subtle variation
    float iceNoise = snoise(vec3(uv * 3.0, uTime * 0.02)) * 0.1;
    vec3 ice = uIceColor + iceNoise;
    
    // Crack pattern using Voronoi edges
    vec2 crackId;
    float v = voronoi(uv * 4.0, crackId);
    float edges = 1.0 - smoothstep(0.0, 0.08, v);
    
    // Animate crack glow
    float crackPulse = 0.5 + 0.5 * sin(uTime * 2.0 + crackId.x * 3.14);
    edges *= (0.6 + crackPulse * 0.4) * (1.0 + uCrackGlow * 2.0);
    
    // Snow accumulation
    float snow = snoise(vec3(uv * 8.0, 0.0));
    snow = smoothstep(0.2, 0.6, snow) * 0.4;
    
    // Combine
    vec3 color = ice;
    color = mix(color, uSnowColor, snow);
    color += uCrackColor * edges * 0.8;
    
    // Subtle reflection
    float reflection = pow(max(dot(vNormal, vec3(0.0, 1.0, 0.0)), 0.0), 2.0) * 0.2;
    color += vec3(0.3, 0.5, 0.6) * reflection;
    
    gl_FragColor = vec4(color, 1.0);
}
`;

// ═══════════════════════════════════════════════════════════════════════════
// AURORA SHADER
// ═══════════════════════════════════════════════════════════════════════════

export const auroraVertexShader = `
uniform float uTime;
varying vec2 vUv;
varying float vWave;

void main() {
    vUv = uv;
    
    // Animated wave displacement
    float wave = sin(position.x * 0.5 + uTime) * sin(position.y * 0.3 + uTime * 0.7);
    vWave = wave;
    
    vec3 pos = position;
    pos.z += wave * 2.0;
    pos.x += sin(position.y * 0.2 + uTime * 0.5) * 1.5;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

export const auroraFragmentShader = `
uniform float uTime;
uniform float uIntensity;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;

varying vec2 vUv;
varying float vWave;

${noiseLib}

void main() {
    // Flowing aurora bands
    float flow = snoise(vec3(vUv.x * 2.0, vUv.y * 0.5 + uTime * 0.3, uTime * 0.1));
    float bands = sin(vUv.y * 10.0 + flow * 3.0 + uTime) * 0.5 + 0.5;
    
    // Color gradient along UV
    vec3 color = mix(uColor1, uColor2, vUv.y);
    color = mix(color, uColor3, sin(vUv.x * 3.14 + uTime * 0.5) * 0.5 + 0.5);
    
    // Intensity variation
    float intensity = bands * (0.3 + flow * 0.3);
    intensity *= smoothstep(0.0, 0.2, vUv.y) * smoothstep(1.0, 0.8, vUv.y);
    intensity *= uIntensity;
    
    // Shimmer
    float shimmer = snoise(vec3(vUv * 20.0, uTime * 2.0)) * 0.15;
    intensity += shimmer;
    
    float alpha = intensity * 0.6;
    
    gl_FragColor = vec4(color * intensity, alpha);
}
`;

// ═══════════════════════════════════════════════════════════════════════════
// SNOW/ICE PARTICLE SHADER
// ═══════════════════════════════════════════════════════════════════════════

export const snowVertexShader = `
uniform float uTime;
uniform float uSize;
attribute float aRandom;
attribute float aSpeed;

varying float vAlpha;
varying float vRandom;

void main() {
    vRandom = aRandom;
    
    vec3 pos = position;
    
    // Falling motion with wrap-around
    float fallDistance = mod(uTime * aSpeed * 2.0 + aRandom * 100.0, 40.0);
    pos.y -= fallDistance;
    
    // Gentle horizontal drift
    pos.x += sin(uTime * 0.5 + aRandom * 6.28) * 0.5;
    pos.z += cos(uTime * 0.3 + aRandom * 6.28) * 0.3;
    
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    
    // Size attenuation
    float size = uSize * (1.0 + aRandom * 0.5);
    gl_PointSize = size * (20.0 / -mvPosition.z);
    
    // Fade based on depth
    vAlpha = 0.6 + 0.4 * aRandom;
    
    gl_Position = projectionMatrix * mvPosition;
}
`;

export const snowFragmentShader = `
uniform vec3 uColor;

varying float vAlpha;
varying float vRandom;

void main() {
    // Soft circular particle
    vec2 center = gl_PointCoord - 0.5;
    float dist = length(center);
    
    if (dist > 0.5) discard;
    
    // Soft edge
    float alpha = smoothstep(0.5, 0.2, dist) * vAlpha;
    
    // Slight sparkle
    float sparkle = 1.0 + sin(vRandom * 100.0) * 0.2;
    
    gl_FragColor = vec4(uColor * sparkle, alpha);
}
`;

// ═══════════════════════════════════════════════════════════════════════════
// ICE SHARD BURST PARTICLE SHADER
// ═══════════════════════════════════════════════════════════════════════════

export const iceShardVertexShader = `
uniform float uTime;
uniform float uSize;
attribute vec3 aVelocity;
attribute float aLife;
attribute float aRandom;

varying float vLife;
varying float vRandom;

void main() {
    vLife = aLife;
    vRandom = aRandom;
    
    vec3 pos = position + aVelocity * uTime;
    
    // Gravity
    pos.y -= uTime * uTime * 2.0;
    
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    
    float size = uSize * aLife * (0.8 + aRandom * 0.4);
    gl_PointSize = size * (25.0 / -mvPosition.z);
    
    gl_Position = projectionMatrix * mvPosition;
}
`;

export const iceShardFragmentShader = `
uniform vec3 uColor;

varying float vLife;
varying float vRandom;

void main() {
    vec2 center = gl_PointCoord - 0.5;
    float dist = length(center);
    
    if (dist > 0.5) discard;
    
    // Hexagonal shape approximation
    float angle = atan(center.y, center.x);
    float hex = cos(angle * 6.0) * 0.1;
    float shape = smoothstep(0.5, 0.3 + hex, dist);
    
    float alpha = shape * vLife;
    
    // Sparkle effect
    float sparkle = 1.0 + sin(vRandom * 50.0 + vLife * 10.0) * 0.3;
    
    gl_FragColor = vec4(uColor * sparkle, alpha);
}
`;

// ═══════════════════════════════════════════════════════════════════════════
// GLACIAL LIGHTNING SHADER
// ═══════════════════════════════════════════════════════════════════════════

export const lightningVertexShader = `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const lightningFragmentShader = `
uniform float uTime;
uniform float uOpacity;
uniform vec3 uColor;

varying vec2 vUv;

void main() {
    // Lightning bolt shape - bright center, fading edges
    float centerDist = abs(vUv.y - 0.5) * 2.0;
    float bolt = smoothstep(1.0, 0.0, centerDist);
    bolt = pow(bolt, 2.0);
    
    // Flicker
    float flicker = 0.7 + 0.3 * sin(uTime * 30.0 + vUv.x * 10.0);
    
    float alpha = bolt * uOpacity * flicker;
    
    // Hot white center, colored edges
    vec3 color = mix(uColor, vec3(1.0), bolt * 0.5);
    
    gl_FragColor = vec4(color, alpha);
}
`;

// ═══════════════════════════════════════════════════════════════════════════
// SHOCKWAVE RING SHADER
// ═══════════════════════════════════════════════════════════════════════════

export const shockwaveVertexShader = `
varying vec2 vUv;
varying vec3 vNormal;

void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const shockwaveFragmentShader = `
uniform float uTime;
uniform float uOpacity;
uniform vec3 uColor;

varying vec2 vUv;
varying vec3 vNormal;

void main() {
    // Ring glow
    float fresnel = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 2.0);
    float intensity = 0.4 + fresnel * 0.6;
    
    vec3 color = uColor * intensity;
    
    gl_FragColor = vec4(color, uOpacity * intensity);
}
`;
