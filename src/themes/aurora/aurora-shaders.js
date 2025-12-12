/**
 * Aurora Theme Shaders
 * 
 * Shaders for creating immersive 3D aurora borealis effects
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
 * Aurora Curtain Vertex Shader
 * Creates flowing wave-like displacement for aurora ribbons
 */
export const auroraCurtainVertexShader = `
uniform float time;
uniform float waveSpeed;
uniform float waveAmplitude;
uniform float layerOffset;

varying vec2 vUv;
varying float vDisplacement;
varying float vHeight;

${noiseGLSL}

void main() {
    vUv = uv;
    vHeight = position.y;
    
    // Create flowing wave motion
    float t = time * waveSpeed + layerOffset;
    
    // Multiple noise octaves for organic movement
    float noise1 = snoise(vec3(position.x * 0.3, position.y * 0.1, t * 0.5)) * waveAmplitude;
    float noise2 = snoise(vec3(position.x * 0.6, position.y * 0.2, t * 0.3)) * waveAmplitude * 0.5;
    float noise3 = snoise(vec3(position.x * 1.2, position.y * 0.4, t * 0.7)) * waveAmplitude * 0.25;
    
    vDisplacement = noise1 + noise2 + noise3;
    
    // Displace in Z direction for depth, and slight X for wave motion
    vec3 displaced = position;
    displaced.z += vDisplacement;
    displaced.x += sin(position.y * 0.5 + t) * waveAmplitude * 0.3;
    
    // Add vertical wave ripple
    displaced.y += sin(position.x * 2.0 + t * 2.0) * 0.3;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`;

/**
 * Aurora Curtain Fragment Shader
 * Creates the glowing, color-shifting aurora effect
 */
export const auroraCurtainFragmentShader = `
uniform float time;
uniform float intensity;
uniform vec3 colorPrimary;   // Deep emerald green
uniform vec3 colorSecondary; // Cyan/teal
uniform vec3 colorTertiary;  // Violet/purple

varying vec2 vUv;
varying float vDisplacement;
varying float vHeight;

${noiseGLSL}

void main() {
    // Vertical gradient - stronger at base, fading up
    float verticalGradient = 1.0 - smoothstep(0.0, 0.9, vUv.y);
    
    // Noise-based color variation
    float colorNoise = snoise(vec3(vUv.x * 3.0, vUv.y * 2.0, time * 0.2));
    float colorNoise2 = snoise(vec3(vUv.x * 5.0, vUv.y * 3.0, time * 0.15));
    
    // Mix between aurora colors based on position and noise
    float mixFactor1 = smoothstep(-0.5, 0.5, colorNoise) * vUv.y;
    float mixFactor2 = smoothstep(-0.3, 0.7, colorNoise2) * (1.0 - vUv.y);
    
    vec3 color = colorPrimary;
    color = mix(color, colorSecondary, mixFactor1 * 0.6);
    color = mix(color, colorTertiary, mixFactor2 * 0.4);
    
    // Edge glow - brighter at horizontal edges
    float edgeGlow = 1.0 - abs(vUv.x - 0.5) * 1.5;
    edgeGlow = smoothstep(0.0, 1.0, edgeGlow);
    
    // Displacement-based brightness variation
    float displacementBrightness = 0.8 + vDisplacement * 0.3;
    
    // Curtain fold effect - creates lighter/darker stripes
    float folds = sin(vUv.x * 20.0 + time * 0.5 + vUv.y * 5.0) * 0.15 + 0.85;
    
    // Shimmer effect
    float shimmer = sin(vUv.x * 50.0 + time * 3.0) * sin(vUv.y * 30.0 + time * 2.0) * 0.1 + 0.9;
    
    // Combine all factors
    float alpha = verticalGradient * edgeGlow * displacementBrightness * intensity;
    alpha *= folds * shimmer;
    
    // Hot spots - brighter concentrated areas
    float hotSpot = smoothstep(0.6, 1.0, snoise(vec3(vUv.x * 4.0, vUv.y * 2.0, time * 0.3)));
    color += vec3(0.3, 0.5, 0.2) * hotSpot * 0.5;
    
    // Apply intensity boost
    color *= (1.0 + intensity * 0.3);
    
    gl_FragColor = vec4(color, alpha * 0.85);
}
`;

/**
 * Star Particle Fragment Shader
 * Creates soft, twinkling stars
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
    alpha *= alpha; // Sharper falloff
    
    gl_FragColor = vec4(vColor, alpha * vAlpha);
}
`;

/**
 * Star Particle Vertex Shader
 * Handles twinkling and size variation
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
    
    // Twinkling effect
    float twinkle = sin(time * 2.0 + aPhase * 10.0) * 0.3 + 0.7;
    vAlpha = twinkle;
    
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    
    // Size attenuation with distance
    gl_PointSize = aSize * (150.0 / -mvPosition.z) * twinkle;
}
`;

/**
 * Nebula/Ambient Particle Vertex Shader
 */
export const nebulaVertexShader = `
uniform float time;
attribute float aRandom;

varying float vAlpha;

void main() {
    vec3 pos = position;
    
    // Gentle floating motion
    pos.y += sin(time * 0.5 + aRandom * 10.0) * 0.5;
    pos.x += cos(time * 0.3 + aRandom * 8.0) * 0.3;
    pos.z += sin(time * 0.4 + aRandom * 6.0) * 0.2;
    
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    
    // Size with depth attenuation
    gl_PointSize = (3.0 + aRandom * 3.0) * (80.0 / -mvPosition.z);
    
    // Pulsing alpha
    vAlpha = 0.4 + 0.3 * sin(time + aRandom * 5.0);
}
`;

/**
 * Nebula/Ambient Particle Fragment Shader
 */
export const nebulaFragmentShader = `
uniform vec3 color;
varying float vAlpha;

void main() {
    vec2 circCoord = 2.0 * gl_PointCoord - 1.0;
    float dist = length(circCoord);
    
    if (dist > 1.0) {
        discard;
    }
    
    // Very soft glow
    float alpha = 1.0 - smoothstep(0.0, 1.0, dist);
    alpha = pow(alpha, 1.5);
    
    gl_FragColor = vec4(color, alpha * vAlpha);
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
    gl_PointSize = (8.0 - aProgress * 6.0) * (100.0 / -mvPosition.z);
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

/**
 * Aurora Pulse Wave Vertex Shader
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
 * Aurora Pulse Wave Fragment Shader
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
    gl_FragColor = vec4(color, opacity * (0.4 + intensity));
}
`;
