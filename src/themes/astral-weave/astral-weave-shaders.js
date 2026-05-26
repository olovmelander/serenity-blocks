/**
 * Astral Weave Theme Shaders
 *
 * GLSL shaders for creating immersive 3D cosmic weave effects
 * Central nexus with energy ribbons weaving through space
 */

// Simplex 3D noise for organic effects
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
 * Energy Ribbon Vertex Shader
 * Creates flowing energy threads that weave through space
 */
export const ribbonVertexShader = `
uniform float time;
uniform float flowSpeed;
uniform float waveIntensity;

varying vec2 vUv;
varying float vEnergy;
varying vec3 vWorldPos;

${noiseGLSL}

void main() {
    vUv = uv;
    
    vec3 pos = position;
    
    // Flowing energy wave along the ribbon
    float wave = sin(uv.x * 10.0 - time * flowSpeed) * waveIntensity;
    float wave2 = sin(uv.x * 20.0 - time * flowSpeed * 1.5) * waveIntensity * 0.5;
    
    // Subtle organic movement
    float organic = snoise(vec3(pos.x * 0.1, pos.y * 0.1, time * 0.2)) * 0.2;
    
    pos.y += wave + wave2 + organic;
    pos.z += cos(uv.x * 8.0 - time * flowSpeed * 0.8) * waveIntensity * 0.5;
    
    // Thickness/width pulsation along normal
    float pulseWave = sin(uv.x * 6.2831853 * 8.0 - time * flowSpeed * 3.5) * 0.06;
    pos += normal * (pulseWave + sin(uv.x * 3.2 - time * flowSpeed) * 0.02);
    
    vEnergy = 0.5 + wave * 2.0;
    vWorldPos = pos;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

/**
 * Energy Ribbon Fragment Shader
 * Glowing, color-shifting energy threads
 */
export const ribbonFragmentShader = `
uniform float time;
uniform float intensity;
uniform vec3 colorA;
uniform vec3 colorB;
uniform vec3 colorC;

varying vec2 vUv;
varying float vEnergy;
varying vec3 vWorldPos;

void main() {
    // Center glow - brighter at center of ribbon
    float centerGlow = 1.0 - abs(vUv.y - 0.5) * 2.0;
    centerGlow = pow(centerGlow, 1.2);
    
    // Flowing color gradient
    float colorFlow = sin(vUv.x * 5.0 - time * 0.5) * 0.5 + 0.5;
    float colorFlow2 = cos(vUv.x * 3.0 + time * 0.3) * 0.5 + 0.5;
    
    vec3 color = mix(colorA, colorB, colorFlow);
    color = mix(color, colorC, colorFlow2 * 0.4);
    
    // Energy pulse traveling along ribbon
    float pulse = sin(vUv.x * 15.0 - time * 3.0) * 0.5 + 0.5;
    pulse = pow(pulse, 3.0);
    
    // Add bright energy core
    color += vec3(1.0, 0.9, 0.8) * pulse * centerGlow * 0.5;
    
    float alpha = centerGlow * intensity * (0.6 + vEnergy * 0.4);
    
    // Brighten the core
    color *= 1.0 + centerGlow * 0.5;
    
    gl_FragColor = vec4(color, alpha);
}
`;

/**
 * Weave Particle Vertex Shader
 * Particles that flow along the weave pattern
 */
export const weaveParticleVertexShader = `
uniform float time;
attribute float aAngle;
attribute float aRadius;
attribute float aSpeed;
attribute float aRandom;
attribute vec3 aColor;

varying vec3 vColor;
varying float vAlpha;

void main() {
    float angle = aAngle + time * aSpeed * 0.5;
    float radius = aRadius + sin(time * 0.5 + aRandom * 6.28) * 0.5;
    
    vec3 pos;
    pos.x = cos(angle) * radius;
    pos.y = sin(time * 0.3 + aRandom * 10.0) * 2.0;
    pos.z = sin(angle) * radius;
    
    // Helical spiral winding around the primary orbit path
    float spiralFreq = 12.0 + aRandom * 6.0;
    float spiralAngle = (aAngle + time * aSpeed) * spiralFreq + aRandom * 6.2831853;
    float spiralRadius = 0.48 + sin((aAngle + time * aSpeed) * 3.5 + aRandom * 6.28) * 0.12;
    
    pos.x += cos(angle) * cos(spiralAngle) * spiralRadius;
    pos.y += sin(spiralAngle) * spiralRadius;
    pos.z += sin(angle) * cos(spiralAngle) * spiralRadius;
    
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    
    float baseSize = 2.0 + aRandom * 3.0;
    gl_PointSize = baseSize * (20.0 / -mvPosition.z);
    
    vColor = aColor;
    vAlpha = 0.4 + 0.4 * sin(time * 2.0 + aRandom * 6.28);
}
`;

/**
 * Weave Particle Fragment Shader
 */
export const weaveParticleFragmentShader = `
varying vec3 vColor;
varying float vAlpha;

void main() {
    vec2 circCoord = 2.0 * gl_PointCoord - 1.0;
    float dist = dot(circCoord, circCoord);
    if (dist > 1.0) discard;
    
    float alpha = vAlpha * (1.0 - smoothstep(0.3, 1.0, dist));
    
    gl_FragColor = vec4(vColor, alpha);
}
`;

/**
 * Background Stars Vertex Shader
 */
export const starsVertexShader = `
uniform float time;
attribute float aRandom;
attribute vec3 aColor;

varying vec3 vColor;
varying float vAlpha;

void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    
    float baseSize = 1.0 + aRandom * 2.5;
    gl_PointSize = baseSize * (30.0 / -mvPosition.z);
    
    vColor = aColor;
    vAlpha = 0.5 + 0.5 * sin(time * (1.0 + aRandom * 2.0) + aRandom * 6.28);
}
`;

/**
 * Background Stars Fragment Shader
 */
export const starsFragmentShader = `
varying vec3 vColor;
varying float vAlpha;

void main() {
    vec2 circCoord = 2.0 * gl_PointCoord - 1.0;
    float dist = dot(circCoord, circCoord);
    if (dist > 1.0) discard;
    
    float alpha = vAlpha * (1.0 - smoothstep(0.2, 1.0, dist));
    
    gl_FragColor = vec4(vColor, alpha);
}
`;

/**
 * Nebula Cloud Vertex Shader
 */
export const nebulaVertexShader = `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * Nebula Cloud Fragment Shader
 */
export const nebulaFragmentShader = `
uniform float time;
uniform float opacity;
uniform vec3 colorA;
uniform vec3 colorB;
uniform vec3 colorC;

varying vec2 vUv;

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

float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
        value += amplitude * noise(p);
        p *= 2.0;
        amplitude *= 0.5;
    }
    return value;
}

void main() {
    vec2 uv = vUv - 0.5;
    
    // Double warping / coordinates churning
    float drift = 0.16;
    vec2 warped = vec2(
        uv.x + sin(uv.y * 6.0 + time * drift) * 0.06 + cos(uv.x * 3.5 - time * drift * 0.4) * 0.04,
        uv.y + cos(uv.x * 5.0 - time * drift * 0.8) * 0.055 + sin(uv.y * 4.0 + time * drift * 0.5) * 0.035
    );
    
    float n1 = fbm(warped * 3.0 + time * 0.02);
    float n2 = fbm(warped * 2.0 - time * 0.015 + vec2(5.0, 3.0));
    
    float finalNoise = (n1 + n2) * 0.5;
    
    float dist = length(uv) * 2.0;
    float falloff = 1.0 - smoothstep(0.2, 1.0, dist);
    
    // Color churning
    float tintMix1 = clamp(finalNoise * 1.2, 0.0, 1.0);
    float tintMix2 = clamp(sin(warped.x * 3.0 + finalNoise * 2.0) * 0.5 + 0.5, 0.0, 1.0);
    
    vec3 color = mix(colorA, colorB, tintMix1);
    color = mix(color, colorC, tintMix2 * 0.42);
    
    float alpha = finalNoise * falloff * opacity * 1.2;
    
    gl_FragColor = vec4(color, alpha);
}
`;

/**
 * Energy Pulse Wave Shaders
 */
export const pulseVertexShader = `
varying vec2 vUv;
varying vec3 vNormal;

void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const pulseFragmentShader = `
uniform float time;
uniform float opacity;
uniform vec3 color;

varying vec2 vUv;
varying vec3 vNormal;

void main() {
    float intensity = pow(0.6 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.0);
    gl_FragColor = vec4(color, opacity * (0.3 + intensity));
}
`;

/**
 * Cosmic Dust Vertex Shader
 */
export const dustVertexShader = `
uniform float time;
attribute float aRandom;
attribute float aSize;

varying float vAlpha;

void main() {
    vec3 pos = position;
    
    // Gentle floating motion
    pos.y += sin(time * 0.5 + aRandom * 10.0) * 0.5;
    pos.x += cos(time * 0.3 + aRandom * 8.0) * 0.3;
    
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    
    gl_PointSize = aSize * (25.0 / -mvPosition.z);
    
    vAlpha = 0.3 + 0.3 * sin(time * 1.5 + aRandom * 10.0);
}
`;

/**
 * Cosmic Dust Fragment Shader
 */
export const dustFragmentShader = `
uniform vec3 color;

varying float vAlpha;

void main() {
    vec2 circCoord = 2.0 * gl_PointCoord - 1.0;
    float dist = dot(circCoord, circCoord);
    if (dist > 1.0) discard;
    
    float alpha = vAlpha * (1.0 - smoothstep(0.5, 1.0, dist));
    
    gl_FragColor = vec4(color, alpha);
}
`;

/**
 * Volumetric Light Shaft Shaders
 */
export const lightShaftVertexShader = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const lightShaftFragmentShader = `
uniform float time;
uniform float opacity;
uniform vec3 colorA;
uniform vec3 colorB;

varying vec2 vUv;

// Simple hash and noise for light shafts
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
    // Vertical fade: fades out at bottom (y=0) and top (y=1)
    float vertFade = smoothstep(0.0, 0.22, vUv.y) * smoothstep(1.0, 0.42, vUv.y);
    
    // Radial fade: cylinder edge soft falloff
    float radFade = smoothstep(0.5, 0.0, abs(vUv.x - 0.5));
    
    // Shimmer/noise along shaft
    vec2 noiseCoords = vec2(vUv.x * 2.2, vUv.y * 0.45 - time * 0.45);
    float shaftNoise = noise(noiseCoords * 4.0) * 0.5 + noise(noiseCoords * 8.0) * 0.25 + 0.25;
    
    vec3 finalColor = mix(colorA, colorB, shaftNoise * 0.75);
    float alpha = vertFade * radFade * (shaftNoise * 0.68 + 0.32) * opacity;
    
    gl_FragColor = vec4(finalColor, alpha);
}
`;

/**
 * Constellation Line Shaders
 */
export const constellationVertexShader = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const constellationFragmentShader = `
uniform float time;
uniform float opacity;
uniform vec3 colorA;
uniform vec3 colorB;

varying vec2 vUv;

void main() {
    float twinkle = sin(time * 2.8 + vUv.x * 12.0) * 0.22 + 0.78;
    vec3 finalColor = mix(colorA, colorB, vUv.x) * twinkle;
    float alpha = opacity * twinkle * smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
    gl_FragColor = vec4(finalColor, alpha);
}
`;
