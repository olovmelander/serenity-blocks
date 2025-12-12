/**
 * Astral Weave Theme Shaders
 * 
 * GLSL shaders for creating immersive 3D cosmic weave effects
 * with flowing threads, stars, nebula, and energy effects.
 */

// Simplex 3D noise functions (shared across shaders)
const noiseGLSL = `
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
`;

/**
 * Cosmic Thread Vertex Shader
 * Minimal displacement - just passes through geometry with subtle animation
 */
export const cosmicThreadVertexShader = `
uniform float time;
uniform float waveSpeed;
uniform float threadOffset;

varying vec2 vUv;
varying float vPosition;

void main() {
    vUv = uv;
    vPosition = position.x;
    
    // Very subtle breathing effect - no displacement, just for fragment shader
    vec3 pos = position;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;


/**
 * Cosmic Thread Fragment Shader
 * Creates elegant glowing cosmic thread effect
 */
export const cosmicThreadFragmentShader = `
uniform float time;
uniform float intensity;
uniform vec3 colorPrimary;
uniform vec3 colorSecondary;
uniform vec3 colorTertiary;

varying vec2 vUv;
varying float vPosition;

void main() {
    // Edge glow - brighter at center of tube
    float edgeGlow = 1.0 - abs(vUv.y - 0.5) * 2.0;
    edgeGlow = pow(edgeGlow, 1.5);
    
    // Smooth color gradient along thread
    float colorMix = sin(vPosition * 0.15 + time * 0.3) * 0.5 + 0.5;
    float colorMix2 = cos(vPosition * 0.08 - time * 0.2) * 0.5 + 0.5;
    
    vec3 color = mix(colorPrimary, colorSecondary, colorMix * 0.6);
    color = mix(color, colorTertiary, colorMix2 * 0.3);
    
    // Energy pulse flowing along thread
    float pulse = sin(vPosition * 0.3 - time * 1.5) * 0.15 + 0.85;
    
    // Combine for final alpha  
    float alpha = edgeGlow * pulse * intensity * 0.9;
    
    // Brighten the core
    color *= 1.0 + edgeGlow * 0.3;
    
    gl_FragColor = vec4(color, alpha);
}
`;


/**
 * Star Field Vertex Shader
 * Handles twinkling and size variation for background stars
 */
export const starVertexShader = `
uniform float time;
attribute float aSize;
attribute float aPhase;
attribute vec3 aColor;

varying float vAlpha;
varying vec3 vColor;

void main() {
    vColor = aColor;
    
    // Twinkling effect with varied speed
    float twinkle = sin(time * 1.5 + aPhase * 10.0) * 0.4 + 0.6;
    vAlpha = twinkle;
    
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    
    // Size attenuation with distance
    gl_PointSize = aSize * (200.0 / -mvPosition.z) * twinkle;
}
`;

/**
 * Star Field Fragment Shader
 * Creates soft, glowing star points
 */
export const starFragmentShader = `
uniform float time;
varying float vAlpha;
varying vec3 vColor;

void main() {
    // Circular point with soft edges
    vec2 circCoord = 2.0 * gl_PointCoord - 1.0;
    float dist = length(circCoord);
    
    if (dist > 1.0) {
        discard;
    }
    
    // Soft glow falloff
    float alpha = 1.0 - smoothstep(0.0, 1.0, dist);
    alpha *= alpha;
    
    gl_FragColor = vec4(vColor, alpha * vAlpha);
}
`;

/**
 * Nebula Particle Vertex Shader
 * Creates floating nebula cloud particles
 */
export const nebulaVertexShader = `
uniform float time;
attribute float aRandom;
attribute vec3 aColor;

varying float vAlpha;
varying vec3 vColor;

void main() {
    vec3 pos = position;
    
    // Gentle floating motion with cosmic drift
    pos.y += sin(time * 0.3 + aRandom * 8.0) * 1.0;
    pos.x += cos(time * 0.25 + aRandom * 6.0) * 0.8;
    pos.z += sin(time * 0.2 + aRandom * 4.0) * 0.6;
    
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    
    // Size with depth attenuation - larger nebula particles
    gl_PointSize = (8.0 + aRandom * 12.0) * (100.0 / -mvPosition.z);
    
    // Pulsing alpha
    vAlpha = 0.3 + 0.2 * sin(time * 0.5 + aRandom * 5.0);
    vColor = aColor;
}
`;

/**
 * Nebula Particle Fragment Shader
 * Creates soft glowing nebula cloud effect
 */
export const nebulaFragmentShader = `
varying float vAlpha;
varying vec3 vColor;

void main() {
    vec2 circCoord = 2.0 * gl_PointCoord - 1.0;
    float dist = length(circCoord);
    
    if (dist > 1.0) {
        discard;
    }
    
    // Very soft glow for nebula
    float alpha = 1.0 - smoothstep(0.0, 1.0, dist);
    alpha = pow(alpha, 1.2);
    
    gl_FragColor = vec4(vColor, alpha * vAlpha);
}
`;

/**
 * Stardust Vertex Shader
 * Small floating particles with twinkle effect
 */
export const stardustVertexShader = `
uniform float time;
attribute float aPhase;
attribute float aSize;

varying float vAlpha;

void main() {
    vec3 pos = position;
    
    // Very gentle drift
    pos += vec3(
        sin(time * 0.2 + aPhase * 5.0) * 0.5,
        cos(time * 0.15 + aPhase * 3.0) * 0.3,
        sin(time * 0.1 + aPhase * 4.0) * 0.4
    );
    
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    
    // Twinkling
    float twinkle = sin(time * 3.0 + aPhase * 15.0) * 0.5 + 0.5;
    vAlpha = twinkle;
    
    gl_PointSize = aSize * (80.0 / -mvPosition.z) * (0.5 + twinkle * 0.5);
}
`;

/**
 * Stardust Fragment Shader
 */
export const stardustFragmentShader = `
varying float vAlpha;

void main() {
    vec2 circCoord = 2.0 * gl_PointCoord - 1.0;
    float dist = length(circCoord);
    
    if (dist > 1.0) {
        discard;
    }
    
    float alpha = 1.0 - smoothstep(0.0, 0.8, dist);
    
    // White/cyan stardust
    vec3 color = vec3(0.8, 0.95, 1.0);
    
    gl_FragColor = vec4(color, alpha * vAlpha * 0.7);
}
`;

/**
 * Energy Pulse Wave Vertex Shader
 * For expanding ring effects
 */
export const pulseWaveVertexShader = `
varying vec2 vUv;
varying vec3 vNormal;

void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * Energy Pulse Wave Fragment Shader
 */
export const pulseWaveFragmentShader = `
uniform float time;
uniform float opacity;
uniform vec3 color;

varying vec2 vUv;
varying vec3 vNormal;

void main() {
    // Ring/edge glow effect
    float intensity = pow(0.7 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 2.0);
    
    // Add shimmer
    float shimmer = sin(vUv.x * 30.0 + time * 5.0) * 0.1 + 0.9;
    
    gl_FragColor = vec4(color * shimmer, opacity * (0.4 + intensity));
}
`;

/**
 * Warp Vortex Vertex Shader
 * Spiraling cosmic distortion effect
 */
export const warpVortexVertexShader = `
uniform float time;
uniform float rotation;

varying vec2 vUv;
varying float vAngle;

void main() {
    vUv = uv;
    
    // Calculate angle for spiral effect
    vec3 pos = position;
    float angle = atan(pos.y, pos.x);
    vAngle = angle;
    
    // Add spiral rotation
    float spiralOffset = sin(angle * 4.0 + time * 2.0) * 0.2;
    pos.z += spiralOffset;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

/**
 * Warp Vortex Fragment Shader
 */
export const warpVortexFragmentShader = `
uniform float time;
uniform float opacity;
uniform vec3 colorA;
uniform vec3 colorB;

varying vec2 vUv;
varying float vAngle;

void main() {
    // Spiral color gradient
    float spiral = sin(vAngle * 4.0 + time * 3.0) * 0.5 + 0.5;
    vec3 color = mix(colorA, colorB, spiral);
    
    // Edge fade
    float edge = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x);
    
    // Energy pulse
    float pulse = sin(time * 4.0 + vAngle * 2.0) * 0.2 + 0.8;
    
    gl_FragColor = vec4(color * pulse, opacity * edge);
}
`;

/**
 * Cosmic Orb Vertex Shader
 * Glowing energy sphere effect
 */
export const cosmicOrbVertexShader = `
uniform float time;
attribute float aPhase;
attribute float aSize;
attribute vec3 aColor;

varying float vAlpha;
varying vec3 vColor;

void main() {
    vColor = aColor;
    
    // Pulsing effect
    float pulse = sin(time * 3.0 + aPhase * 8.0) * 0.3 + 0.7;
    vAlpha = pulse;
    
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    
    gl_PointSize = aSize * (120.0 / -mvPosition.z) * pulse;
}
`;

/**
 * Cosmic Orb Fragment Shader
 */
export const cosmicOrbFragmentShader = `
varying float vAlpha;
varying vec3 vColor;

void main() {
    vec2 circCoord = 2.0 * gl_PointCoord - 1.0;
    float dist = length(circCoord);
    
    if (dist > 1.0) {
        discard;
    }
    
    // Core glow
    float core = 1.0 - smoothstep(0.0, 0.3, dist);
    // Outer glow
    float glow = 1.0 - smoothstep(0.0, 1.0, dist);
    glow = pow(glow, 1.5);
    
    vec3 color = vColor + vec3(1.0) * core * 0.5;
    float alpha = glow * vAlpha;
    
    gl_FragColor = vec4(color, alpha);
}
`;

/**
 * Shooting Star Trail Vertex Shader
 */
export const shootingStarVertexShader = `
attribute float aProgress;
varying float vProgress;

void main() {
    vProgress = aProgress;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = (10.0 - aProgress * 8.0) * (120.0 / -mvPosition.z);
}
`;

/**
 * Shooting Star Trail Fragment Shader
 */
export const shootingStarFragmentShader = `
uniform vec3 color;
uniform float opacity;
varying float vProgress;

void main() {
    vec2 circCoord = 2.0 * gl_PointCoord - 1.0;
    float dist = length(circCoord);
    
    if (dist > 1.0) {
        discard;
    }
    
    float alpha = 1.0 - smoothstep(0.0, 1.0, dist);
    alpha *= (1.0 - vProgress) * opacity;
    
    gl_FragColor = vec4(color, alpha);
}
`;
