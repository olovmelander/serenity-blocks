/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * FLUID DREAMS THEME - GLSL Shaders
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Custom shaders for the Fluid Dreams theme featuring:
 * - Iridescent bubble effect with Fresnel rainbow
 * - Background void with dreamy gradient animation
 * - Morphing blob vertex animation
 * - Flowing ribbon gradient
 * - Shockwave ripple distortion
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// BACKGROUND SHADER - Dreamy cosmic void
// ─────────────────────────────────────────────────────────────────────────────

export const backgroundVertexShader = `
varying vec2 vUv;
varying vec3 vPosition;

void main() {
    vUv = uv;
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const backgroundFragmentShader = `
uniform float uTime;
uniform float uPulseIntensity;

varying vec2 vUv;
varying vec3 vPosition;

// Simplex noise for organic movement
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
    
    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
    
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

void main() {
    // Normalize position for sphere mapping
    vec3 dir = normalize(vPosition);
    
    // Base gradient - deep purple to cyan
    float gradient = (dir.y + 1.0) * 0.5;
    
    // Dreamy color palette
    vec3 deepPurple = vec3(0.08, 0.02, 0.15);
    vec3 midPurple = vec3(0.15, 0.05, 0.25);
    vec3 cyan = vec3(0.05, 0.12, 0.20);
    vec3 pink = vec3(0.18, 0.05, 0.12);
    
    // Base color blend
    vec3 color = mix(deepPurple, midPurple, gradient);
    color = mix(color, cyan, smoothstep(0.3, 0.7, gradient));
    
    // Animated noise layers
    float time = uTime * 0.05;
    float n1 = snoise(dir * 2.0 + time) * 0.5 + 0.5;
    float n2 = snoise(dir * 4.0 - time * 0.7) * 0.5 + 0.5;
    float n3 = snoise(dir * 1.0 + time * 0.3) * 0.5 + 0.5;
    
    // Nebula clouds
    vec3 nebula1 = mix(midPurple, pink, n1 * 0.5) * n1 * 0.4;
    vec3 nebula2 = mix(cyan, vec3(0.1, 0.05, 0.2), n2 * 0.5) * n2 * 0.3;
    
    color += nebula1 + nebula2;
    
    // Subtle stars
    float stars = pow(n3, 8.0) * 0.3;
    color += vec3(stars);
    
    // Pulse effect from gameplay
    color += vec3(0.1, 0.05, 0.15) * uPulseIntensity * 0.3;
    
    gl_FragColor = vec4(color, 1.0);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// IRIDESCENT BUBBLE SHADER
// ─────────────────────────────────────────────────────────────────────────────

export const bubbleVertexShader = `
uniform float uTime;
uniform float uPulseIntensity;

varying vec3 vNormal;
varying vec3 vViewPosition;
varying vec2 vUv;
varying float vNoise;

// Simple noise for surface variation
float noise(vec3 p) {
    return fract(sin(dot(p, vec3(12.9898, 78.233, 45.5432))) * 43758.5453);
}

void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    
    // Subtle surface wobble
    float wobble = sin(uTime * 2.0 + position.x * 3.0) * 0.02;
    wobble += sin(uTime * 1.5 + position.y * 4.0) * 0.015;
    wobble += sin(uTime * 1.8 + position.z * 2.5) * 0.015;
    
    // Add pulse effect - Expansion
    float pulseScale = 1.0 + uPulseIntensity * 0.4;
    
    vec3 newPosition = position * pulseScale + normal * wobble;
    
    vec4 mvPosition = modelViewMatrix * vec4(newPosition, 1.0);
    vViewPosition = -mvPosition.xyz;
    vNoise = noise(position * 10.0 + uTime * 0.5);
    
    gl_Position = projectionMatrix * mvPosition;
}
`;

export const bubbleFragmentShader = `
uniform float uTime;
uniform float uOpacity;
uniform vec3 uBaseColor;
uniform samplerCube uEnvMap;
uniform float uEnvMapIntensity;
uniform float uPulseIntensity;

varying vec3 vNormal;
varying vec3 vViewPosition;
varying vec2 vUv;
varying float vNoise;

// Rainbow color from angle
vec3 rainbow(float t) {
    t = fract(t);
    float r = abs(t * 6.0 - 3.0) - 1.0;
    float g = 2.0 - abs(t * 6.0 - 2.0);
    float b = 2.0 - abs(t * 6.0 - 4.0);
    return clamp(vec3(r, g, b), 0.0, 1.0);
}

void main() {
    vec3 viewDir = normalize(vViewPosition);
    vec3 normal = normalize(vNormal);
    
    // Fresnel effect for edge glow
    float fresnel = pow(1.0 - abs(dot(viewDir, normal)), 3.0);
    
    // Thin film interference - creates rainbow iridescence
    float interference = dot(viewDir, normal);
    float phase = interference * 8.0 + uTime * 0.5 + vNoise * 2.0;
    
    // Rainbow color based on viewing angle
    vec3 iridescence = rainbow(phase * 0.2);
    
    // Environment reflection
    vec3 reflectDir = reflect(-viewDir, normal);
    vec3 envColor = textureCube(uEnvMap, reflectDir).rgb * uEnvMapIntensity;
    
    // Combine colors
    vec3 baseColor = uBaseColor;
    vec3 color = mix(baseColor, iridescence, fresnel * 0.7);
    color = mix(color, envColor, fresnel * 0.5);
    
    // Add rim glow
    color += iridescence * fresnel * 0.6;
    
    // Soap film shimmer
    float shimmer = sin(phase * 6.0) * 0.1 + 0.9;
    color *= shimmer;
    
    // Pulse Flash - Boost brightness without washing out
    // Using baseColor to keep it tinted
    color += baseColor * uPulseIntensity * 1.0;
    
    // Transparency based on Fresnel
    // Boost opacity significantly during pulse
    float pulseOpacity = uPulseIntensity * 0.4;
    float alpha = mix(0.2, 0.8, fresnel) * (uOpacity + pulseOpacity);
    
    gl_FragColor = vec4(color, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// MORPHING BLOB VERTEX SHADER
// ─────────────────────────────────────────────────────────────────────────────

export const blobVertexShader = `
uniform float uTime;
uniform float uMorphSpeed;
uniform float uMorphAmount;
uniform float uPulseIntensity;
uniform vec3 uMorphSeed;

varying vec3 vNormal;
varying vec3 vViewPosition;
varying vec2 vUv;
varying float vDisplacement;

// 3D Simplex noise (inlined for vertex shader)
vec3 mod289v(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289v(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permutev(vec4 x) { return mod289v(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrtv(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise3(vec3 v) {
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
    
    i = mod289v(i);
    vec4 p = permutev(permutev(permutev(
        i.z + vec4(0.0, i1.z, i2.z, 1.0))
        + i.y + vec4(0.0, i1.y, i2.y, 1.0))
        + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    
    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
    
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    
    vec4 norm = taylorInvSqrtv(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;
    
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

void main() {
    vUv = uv;
    
    // Multiple noise layers for organic morphing
    float time = uTime * uMorphSpeed;
    vec3 samplePos = position * 1.5 + uMorphSeed;
    
    float n1 = snoise3(samplePos + time * 0.3);
    float n2 = snoise3(samplePos * 2.0 - time * 0.5) * 0.5;
    float n3 = snoise3(samplePos * 0.5 + time * 0.2) * 0.3;
    
    float displacement = (n1 + n2 + n3) * uMorphAmount;
    
    // Add pulse effect
    displacement += uPulseIntensity * 0.3;
    
    vDisplacement = displacement;
    
    vec3 newPosition = position + normal * displacement;
    
    // Calculate new normal (approximate)
    float eps = 0.01;
    vec3 tangent = normalize(cross(normal, vec3(0.0, 1.0, 0.0)));
    vec3 bitangent = normalize(cross(normal, tangent));
    
    vec3 p1 = position + tangent * eps;
    vec3 p2 = position + bitangent * eps;
    
    float d1 = snoise3((p1 * 1.5 + uMorphSeed) + time * 0.3) * uMorphAmount;
    float d2 = snoise3((p2 * 1.5 + uMorphSeed) + time * 0.3) * uMorphAmount;
    
    vec3 newP1 = p1 + normal * d1;
    vec3 newP2 = p2 + normal * d2;
    
    vec3 newTangent = newP1 - newPosition;
    vec3 newBitangent = newP2 - newPosition;
    vec3 newNormal = normalize(cross(normalize(newTangent), normalize(newBitangent)));
    
    vNormal = normalize(normalMatrix * newNormal);
    
    vec4 mvPosition = modelViewMatrix * vec4(newPosition, 1.0);
    vViewPosition = -mvPosition.xyz;
    
    gl_Position = projectionMatrix * mvPosition;
}
`;

export const blobFragmentShader = `
uniform float uTime;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform float uPulseIntensity;
uniform samplerCube uEnvMap;
uniform float uEnvMapIntensity;
uniform float uClearcoat;
uniform float uRoughness;
uniform float uMetalness;

varying vec3 vNormal;
varying vec3 vViewPosition;
varying vec2 vUv;
varying float vDisplacement;

void main() {
    vec3 viewDir = normalize(vViewPosition);
    vec3 normal = normalize(vNormal);
    
    // Fresnel for rim lighting
    float fresnel = pow(1.0 - abs(dot(viewDir, normal)), 4.0);
    
    // Color based on displacement - creates organic color variation
    float colorMix = vDisplacement * 2.0 + 0.5;
    vec3 baseColor = mix(uColor1, uColor2, smoothstep(0.3, 0.7, colorMix));
    baseColor = mix(baseColor, uColor3, smoothstep(0.6, 1.0, colorMix));
    
    // Environment reflection
    vec3 reflectDir = reflect(-viewDir, normal);
    vec3 envColor = textureCube(uEnvMap, reflectDir).rgb;
    
    // Metallic-like reflection blend
    float reflectivity = mix(0.04, 1.0, uMetalness);
    vec3 color = mix(baseColor, envColor, fresnel * reflectivity * uEnvMapIntensity);
    
    // Clearcoat layer - adds bright specular
    vec3 halfVector = normalize(viewDir + vec3(0.0, 1.0, 0.5)); // Simple light direction
    float specular = pow(max(dot(normal, halfVector), 0.0), 32.0 * (1.0 - uRoughness));
    color += vec3(1.0) * specular * uClearcoat * 0.5;
    
    // Rim glow
    color += (uColor1 + uColor2) * 0.5 * fresnel * 0.6;
    
    // Iridescent shimmer based on view angle
    float iridescence = sin(dot(viewDir, normal) * 10.0 + uTime * 2.0) * 0.1 + 0.9;
    color *= iridescence;
    
    // Pulse effect
    color += vec3(0.2, 0.1, 0.3) * uPulseIntensity * 0.5;
    
    // Add subtle subsurface scattering look
    float sss = pow(max(dot(-viewDir, normal), 0.0), 2.0) * 0.2;
    color += uColor2 * sss;
    
    gl_FragColor = vec4(color, 0.95);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// FLOWING RIBBON SHADER
// ─────────────────────────────────────────────────────────────────────────────

export const ribbonVertexShader = `
uniform float uTime;

varying vec2 vUv;
varying float vProgress;

attribute float aProgress;

void main() {
    vUv = uv;
    vProgress = aProgress;
    
    // Gentle wave animation along ribbon
    vec3 pos = position;
    float wave = sin(aProgress * 6.28318 * 3.0 + uTime * 2.0) * 0.5;
    pos += normal * wave;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

export const ribbonFragmentShader = `
uniform float uTime;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform float uOpacity;
uniform float uPulseIntensity;

varying vec2 vUv;
varying float vProgress;

void main() {
    // Flowing gradient based on progress and time
    float flow = fract(vProgress - uTime * 0.2);
    
    // Multi-color gradient
    vec3 color = mix(uColor1, uColor2, smoothstep(0.0, 0.5, flow));
    color = mix(color, uColor3, smoothstep(0.5, 1.0, flow));
    
    // Edge fade for soft ribbon look
    float edgeFade = 1.0 - abs(vUv.x - 0.5) * 2.0;
    edgeFade = smoothstep(0.0, 0.3, edgeFade);
    
    // Head/tail fade
    float headTailFade = smoothstep(0.0, 0.1, vProgress) * smoothstep(1.0, 0.9, vProgress);
    
    // Shimmer effect
    float shimmer = sin(vProgress * 20.0 + uTime * 5.0) * 0.15 + 0.85;
    color *= shimmer;
    
    // Pulse boost
    color += vec3(0.1, 0.05, 0.15) * uPulseIntensity;
    
    float alpha = edgeFade * headTailFade * uOpacity;
    
    gl_FragColor = vec4(color, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// PARTICLE SHIMMER SHADER
// ─────────────────────────────────────────────────────────────────────────────

export const particleVertexShader = `
uniform float uTime;
uniform float uSize;
uniform float uPulseIntensity;

attribute float aPhase;
attribute float aSize;
attribute vec3 aColor;

varying vec3 vColor;
varying float vAlpha;

void main() {
    vColor = aColor;
    
    // Twinkle effect
    float twinkle = sin(uTime * 3.0 + aPhase * 6.28318) * 0.5 + 0.5;
    twinkle = pow(twinkle, 2.0);
    
    // Reduced alpha to prevent whiteout
    vAlpha = 0.15 + twinkle * 0.35;
    vAlpha *= (1.0 + uPulseIntensity * 0.5);
    
    // Size variation
    float size = aSize * uSize * (0.8 + twinkle * 0.4);
    size *= (1.0 + uPulseIntensity * 0.3);
    
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
}
`;

export const particleFragmentShader = `
varying vec3 vColor;
varying float vAlpha;

void main() {
    // Circular particle with soft edges
    vec2 center = gl_PointCoord - 0.5;
    float dist = length(center);
    
    if (dist > 0.5) discard;
    
    float alpha = smoothstep(0.5, 0.1, dist) * vAlpha;
    
    // Add glow
    vec3 color = vColor;
    color += vColor * smoothstep(0.3, 0.0, dist) * 0.5;
    
    gl_FragColor = vec4(color, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// SHOCKWAVE SHADER - For combo effects
// ─────────────────────────────────────────────────────────────────────────────

export const shockwaveVertexShader = `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const shockwaveFragmentShader = `
uniform float uTime;
uniform float uRadius;
uniform float uMaxRadius;
uniform vec3 uColor;
uniform float uIntensity;

varying vec2 vUv;

void main() {
    vec2 center = vUv - 0.5;
    float dist = length(center) * 2.0;
    
    // Ring at current radius
    float ringWidth = 0.1;
    float ring = smoothstep(uRadius - ringWidth, uRadius, dist) *
                 smoothstep(uRadius + ringWidth, uRadius, dist);
    
    // Fade based on expansion
    float fade = 1.0 - (uRadius / uMaxRadius);
    
    vec3 color = uColor * ring * fade * uIntensity;
    float alpha = ring * fade * 0.8;
    
    gl_FragColor = vec4(color, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// PRISM BURST SHADER - For high combos
// ─────────────────────────────────────────────────────────────────────────────

export const prismBurstVertexShader = `
attribute float aAngle;
attribute float aLength;
attribute float aHue;

uniform float uTime;
uniform float uExpansion;

varying float vHue;
varying float vAlpha;

void main() {
    vHue = aHue;
    
    // Ray extends outward
    float rayLength = aLength * uExpansion;
    vec3 direction = vec3(cos(aAngle), sin(aAngle), 0.0);
    vec3 pos = position + direction * rayLength;
    
    // Fade as it expands
    vAlpha = 1.0 - (uExpansion / 2.0);
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = 4.0;
}
`;

export const prismBurstFragmentShader = `
varying float vHue;
varying float vAlpha;

// HSL to RGB conversion
vec3 hsl2rgb(float h, float s, float l) {
    vec3 rgb = clamp(abs(mod(h*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0, 0.0, 1.0);
    return l + s * (rgb - 0.5) * (1.0 - abs(2.0 * l - 1.0));
}

void main() {
    vec3 color = hsl2rgb(vHue, 0.8, 0.6);
    gl_FragColor = vec4(color, vAlpha);
}
`;
