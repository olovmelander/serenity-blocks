/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  🌑 COSMIC NOIR SHADERS 🌑
 *  Custom GLSL shaders for the Cosmic Noir 3D Theme
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * A monochromatic noir aesthetic with deep blacks, subtle grays, and ethereal whites.
 * Inspired by the void of deep space - mysterious, elegant, and cinematic.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Simplex 3D Noise - Used across multiple shaders
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
    for (int i = 0; i < 5; i++) {
        v += a * snoise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Black Planet Shader - Deep void with subtle surface texture
// ─────────────────────────────────────────────────────────────────────────────
export const planetVertexShader = `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vPosition;
varying vec3 vLocalPos;
varying vec3 vViewPosition;

void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vPosition = position;
    vLocalPos = position;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
}
`;

export const planetFragmentShader = `
uniform float uTime;
uniform float uPulseIntensity;
uniform float uGlowIntensity;
uniform sampler2D uMap;
uniform vec3 uSunDirection;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vPosition;
varying vec3 vLocalPos;
varying vec3 vViewPosition;

${noiseCommon}

void main() {
    vec3 viewDir = normalize(vViewPosition); // View direction
    vec3 normal = normalize(vNormal); // Surface normal

    // 1. Singularity Core & Photon Ring
    float NdotV = dot(normal, viewDir);
    float fresnel = 1.0 - abs(NdotV);
    
    // The event horizon: pure black center
    float coreMask = smoothstep(0.85, 0.98, fresnel);
    
    // Intense photon ring at the edge
    float photonRing = pow(fresnel, 5.0) * 1.5;
    float sharpRing = pow(fresnel, 20.0) * 3.0;
    
    // 2. Plasma Noise
    float time = uTime * 0.5;
    float ringNoise = fbm(vLocalPos * 8.0 + vec3(0.0, time, time * 0.5));
    
    // 3. Fracture Effect (Combos)
    float fracture = (snoise(vLocalPos * 15.0 - vec3(uTime * 2.0)) * 0.5 + 0.5) * uPulseIntensity;
    
    // 4. Noir Coloring
    vec3 ringColorBase = vec3(0.8, 0.85, 1.0); // Silver-blue
    vec3 hotCore = vec3(1.0, 1.0, 1.0); // Pure white
    
    vec3 ringColor = mix(ringColorBase, hotCore, ringNoise * 0.5 + 0.5);
    ringColor += ringColorBase * fracture * 2.0;

    // 5. Final Composition
    vec3 finalColor = ringColor * (photonRing + sharpRing) * coreMask;
    
    // Apply Glow Intensity & Pulse
    finalColor *= uGlowIntensity * (1.0 + uPulseIntensity * 1.5);

    gl_FragColor = vec4(finalColor, 1.0);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Cosmic Wave Shader - Expanding silver rings
// ─────────────────────────────────────────────────────────────────────────────
export const waveVertexShader = `
varying vec2 vUv;
varying vec3 vNormal;

void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const waveFragmentShader = `
uniform float uTime;
uniform float uOpacity;
uniform vec3 uColor;

varying vec2 vUv;
varying vec3 vNormal;

void main() {
    float intensity = pow(0.6 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 2.0);
    vec3 color = uColor * (0.5 + intensity * 0.5);
    gl_FragColor = vec4(color, uOpacity * (0.3 + intensity * 0.7));
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Particle Shader - Floating noir dust
// ─────────────────────────────────────────────────────────────────────────────
export const particleVertexShader = `
uniform float uTime;
attribute float aRandom;
attribute float aSize;
varying float vAlpha;
varying vec3 vColor;

void main() {
    vec3 pos = position;
    
    // Gentle orbital movement
    float angle = uTime * 0.08 * (1.0 + aRandom * 0.5);
    float s = sin(angle);
    float c = cos(angle);
    vec3 rotatedPos = vec3(pos.x * c - pos.z * s, pos.y, pos.x * s + pos.z * c);
    
    // Vertical float
    rotatedPos.y += sin(uTime * 0.4 + aRandom * 10.0) * 0.5;
    
    vec4 mvPosition = modelViewMatrix * vec4(rotatedPos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    
    // Size with attenuation
    gl_PointSize = aSize * (200.0 / -mvPosition.z);
    
    // Pulsing alpha
    vAlpha = 0.3 + 0.3 * sin(uTime * 1.5 + aRandom * 10.0);
    
    // Grayscale color variation
    float brightness = 0.4 + aRandom * 0.4;
    vColor = vec3(brightness, brightness, brightness + 0.02); // Tiny blue tint
}
`;

export const particleFragmentShader = `
varying float vAlpha;
varying vec3 vColor;

void main() {
    // Soft circular particle
    vec2 circCoord = 2.0 * gl_PointCoord - 1.0;
    float dist = length(circCoord);
    if (dist > 1.0) discard;
    
    float alpha = (1.0 - smoothstep(0.5, 1.0, dist)) * vAlpha;
    gl_FragColor = vec4(vColor, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Star Shader - Round, atmospheric twinkling stars with uniform speed (Blood Moon quality)
// ─────────────────────────────────────────────────────────────────────────────
export const starVertexShader = `
attribute float aSize;
attribute vec2 aTwinkle; // x = phase offset, y = speed multiplier
attribute float aBrightness;

uniform float uTime;
uniform float uPixelRatio;
uniform float uEventBoost;

varying float vBrightness;
varying vec3 vColor;

void main() {
    vColor = color;
    
    // Twinkle animation with varied speed per star
    float twinkle = sin(uTime * aTwinkle.y + aTwinkle.x);
    vBrightness = aBrightness * (0.7 + twinkle * 0.3);
    vBrightness *= (1.0 + uEventBoost * 0.5);
    
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    
    // Size attenuation for depth - larger for atmospheric look
    gl_PointSize = aSize * uPixelRatio * (300.0 / -mvPosition.z);
    gl_PointSize = clamp(gl_PointSize, 3.0, 80.0);
    
    gl_Position = projectionMatrix * mvPosition;
}
`;

export const starFragmentShader = `
varying float vBrightness;
varying vec3 vColor;

void main() {
    // Soft circular point with atmospheric glow
    vec2 center = gl_PointCoord - 0.5;
    float dist = length(center) * 2.0;
    
    // Discard outside circle for round shape
    if (dist > 1.0) discard;
    
    // Soft atmospheric falloff - smooth gradient from center
    float softCircle = 1.0 - smoothstep(0.0, 1.0, dist);
    softCircle = pow(softCircle, 0.8); // Slightly wider glow
    
    // Bright core with halo
    float core = 1.0 - smoothstep(0.0, 0.25, dist);
    
    // Color with boosted core brightness
    vec3 coreColor = vColor * vBrightness * 1.5 + vec3(0.15) * core;
    
    // Atmospheric alpha with minimum visibility
    float alpha = softCircle * (vBrightness + 0.2);
    
    gl_FragColor = vec4(coreColor, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Nebula Shader - White/Silver texture based with soft edge fade (Noir)
// ─────────────────────────────────────────────────────────────────────────────
export const nebulaVertexShader = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export const nebulaFragmentShader = `
    uniform sampler2D tDiffuse;
    uniform sampler2D uNoiseMap;
    uniform float uOpacity;
    uniform float uPulse;
    uniform float uTime;
    varying vec2 vUv;

    void main() {
        float flowTime = uTime * 0.03;
        vec4 noiseA = texture2D(uNoiseMap, vUv * 0.42 + vec2(flowTime, -flowTime * 0.5));
        vec4 noiseB = texture2D(uNoiseMap, vUv * 0.78 + vec2(-flowTime * 0.35, flowTime * 0.42) + vec2(0.17, 0.39));
        vec4 veilNoise = texture2D(uNoiseMap, vUv * 0.24 + vec2(flowTime * 0.18, -flowTime * 0.14) + vec2(0.61, 0.11));
        vec2 primaryDistortion = ((vec2(noiseA.r + noiseB.b, noiseA.g + noiseB.r) * 0.5) - 0.5) * 0.05;
        vec2 secondaryDistortion = (vec2(noiseB.g, noiseA.b) - 0.5) * 0.014;
        vec2 distortedUv = vUv + primaryDistortion + secondaryDistortion;
        vec2 softUv = vUv + primaryDistortion * 0.35;

        vec4 texColor = texture2D(tDiffuse, distortedUv);
        vec4 softTexColor = texture2D(tDiffuse, softUv);

        // Aggressive edge fade to hide plane boundaries and blend properly
        float fadeX = smoothstep(0.0, 0.4, distortedUv.x) * smoothstep(1.0, 0.6, distortedUv.x);
        float fadeY = smoothstep(0.0, 0.4, distortedUv.y) * smoothstep(1.0, 0.6, distortedUv.y);
        float fade = fadeX * fadeY;
        fade = pow(clamp(fade, 0.0, 1.0), 0.9);

        // Desaturate so Blood Moon texture structure renders as noir-white gas.
        float gray = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));
        float softGray = dot(softTexColor.rgb, vec3(0.299, 0.587, 0.114));
        float mergedGray = mix(gray, softGray, 0.42);
        float veil = smoothstep(0.28, 0.78, veilNoise.r * 0.55 + veilNoise.g * 0.45);
        gray = pow(clamp(mergedGray * 1.75 + veil * 0.12, 0.0, 1.0), 0.68);
        float whiteLift = smoothstep(0.34, 0.96, gray);

        // Cool silver-white tint for depth without color bleed.
        vec3 billowBase = vec3(gray) * vec3(0.94, 0.97, 1.0);
        vec3 color = mix(billowBase, vec3(1.0), whiteLift * 0.22);

        // Pulse effect boosts brightness
        float pulseFactor = 1.0 + uPulse * 0.35;
        color *= pulseFactor;

        // Luminance-driven alpha keeps shape detail from reused colored textures.
        float alpha = clamp(gray * (veil * 0.35 + 0.78) * (uOpacity + uPulse * 0.14 + 0.08) * fade * 1.22, 0.0, 0.9);

        gl_FragColor = vec4(color, alpha);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Atmosphere Shader - Swirling gas shell around the planet
// ─────────────────────────────────────────────────────────────────────────────
export const atmosphereVertexShader = `
varying vec3 vNormal;
varying vec3 vPosition;
varying vec3 vViewPosition;

void main() {
    vNormal = normalize(normalMatrix * normal);
    vPosition = position;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
}
`;

export const atmosphereFragmentShader = `
uniform float uTime;
uniform float uPulseIntensity;
uniform float uExplosionTimer;
uniform float uExplosionIntensity;
uniform sampler2D uNoiseMap;

varying vec3 vNormal;
varying vec3 vPosition;
varying vec3 vViewPosition;

void main() {
    vec3 viewDir = normalize(vViewPosition);
    vec3 pos = normalize(vPosition);

    // View dependency for rim softness
    float fresnel = 1.0 - abs(dot(vNormal, viewDir));
    fresnel = pow(fresnel, 2.0);

    float flowTime = uTime * 0.8;
    vec4 flowA = texture2D(
        uNoiseMap,
        vec2(pos.x, pos.y) * 0.34 + vec2(flowTime * 0.12, -flowTime * 0.09) + vec2(pos.z, pos.x) * 0.08
    );
    vec2 warpOffset = (flowA.xy - 0.5) * 0.18;
    vec4 flowB = texture2D(
        uNoiseMap,
        vec2(pos.z, pos.x) * 0.46 + vec2(-flowTime * 0.08, flowTime * 0.11) + warpOffset
    );
    vec4 tendrilTex = texture2D(
        uNoiseMap,
        vec2(pos.y, pos.z) * 0.72 + vec2(flowTime * 0.18, -flowTime * 0.15) + warpOffset * 1.15
    );

    float flowDensityPulse = flowB.z * 0.45 + 0.78;
    float flowTurbulence = flowA.z * 0.6 + 0.55;
    float gasA = flowA.z * 0.7 + flowB.x * 0.3;
    float gasB = flowB.y * 0.62 + flowA.y * 0.38;
    float breath = sin(uTime * 0.55) * 0.08 + 1.0;
    float tendrilField = tendrilTex.x * 0.6 + tendrilTex.y * 0.4;
    float tendrilMask = smoothstep(0.42, 0.85, tendrilField) * flowTurbulence;
    float gas = mix(gasA, gasB, 0.4) * flowDensityPulse * breath + tendrilMask * 0.2;

    float explosionAge = max(0.0, uExplosionTimer);
    float explosionIn = smoothstep(0.0, 0.15, explosionAge);
    float explosionOut = 1.0 - smoothstep(2.5, 4.0, explosionAge);
    float explosionWindow = explosionIn * explosionOut;

    float radialDist = length(vec2(pos.x, pos.y));
    float pulseWave = (sin(uTime * 4.0 - radialDist * 8.0) * 0.5 + 0.5) * uPulseIntensity * 0.35;
    float shockPhase = sin(explosionAge * 12.0 - radialDist * 6.0) * 0.5 + 0.5;
    float shockwave = shockPhase * explosionWindow * uExplosionIntensity * flowTurbulence;

    vec3 tendrilGlow = vec3(0.22, 0.22, 0.3) * (tendrilMask * 0.1 + pulseWave * 0.5);
    vec3 finalColor = mix(vec3(0.03, 0.03, 0.045), vec3(0.11, 0.11, 0.16), gas) * (1.0 + uPulseIntensity * 0.5);
    finalColor += tendrilGlow;
    finalColor += vec3(0.32, 0.32, 0.4) * (shockwave * 0.35);

    float density = smoothstep(0.2, 0.8, gas);
    float alpha = clamp(
        density * 0.16
        + fresnel * 0.23
        + shockwave * 0.28
        + tendrilMask * 0.085
        + pulseWave * 0.065
        + 0.035,
        0.0,
        0.46
    );

    gl_FragColor = vec4(finalColor, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Void Spark Shader - Explosive silver/gray burst from planet surface outward
// ─────────────────────────────────────────────────────────────────────────────
export const voidSparkVertexShader = `
uniform float time;
uniform float uPulseTimer;

attribute float aTheta;
attribute float aPhi;
attribute float aRadius;
attribute float aRandom;
attribute vec3 aColor;

varying vec3 vColor;
varying float vAlpha;

void main() {
    // Initial position on planet surface (spherical coordinates)
    vec3 initialPos;
    initialPos.x = aRadius * sin(aPhi) * cos(aTheta);
    initialPos.y = aRadius * sin(aPhi) * sin(aTheta);
    initialPos.z = aRadius * cos(aPhi);

    // Radial direction - outward from planet center
    vec3 radialDir = normalize(initialPos);

    // Stagger eruption timing based on random value
    float triggerTime = aRandom * 3.5; // Wider stagger
    float age = uPulseTimer - triggerTime;

    vec3 animatedPos = initialPos;
    float alpha = 0.0;
    float size = 0.0;

    // Effect parameters - increased life for longer visibility
    float maxLife = 90.0;

    if (age > 0.0 && age < maxLife) {
        // VOID EXPLOSION! Burst outward from planet surface

        // Add random spread to the radial direction - increased for more volume
        float spreadX = (aRandom - 0.5) * 0.45;
        float spreadY = (fract(aRandom * 7.0) - 0.5) * 0.45;
        float spreadZ = (fract(aRandom * 13.0) - 0.5) * 0.45;
        vec3 burstDir = normalize(radialDir + vec3(spreadX, spreadY, spreadZ));

        // Strong outward velocity - speed increased significantly
        float speed = 40.0 + aRandom * 25.0;
        vec3 velocity = burstDir * speed;

        // Apply velocity over time with better deceleration curve
        float decel = 1.0 - pow(age / maxLife, 1.2);
        animatedPos += velocity * age * max(decel, 0.35);

        // Fade out over lifetime
        alpha = 1.0 - (age / maxLife);
        alpha = pow(alpha, 0.45); // Slower initial fade

        // Larger particles that scale down
        size = (1.2 - (age / maxLife) * 0.8) * 45.0;
    }

    vec4 mvPosition = modelViewMatrix * vec4(animatedPos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    // Large point size for dramatic explosion
    gl_PointSize = size * (300.0 / -mvPosition.z);
    gl_PointSize = clamp(gl_PointSize, 3.0, 100.0); // Slightly higher max clamp

    vColor = aColor;
    vAlpha = alpha;
}
`;

export const voidSparkFragmentShader = `
varying vec3 vColor;
varying float vAlpha;

void main() {
    if (vAlpha <= 0.01) discard;

    vec2 circCoord = 2.0 * gl_PointCoord - 1.0;
    float dist = dot(circCoord, circCoord);
    if (dist > 1.0) discard;

    // Bright hot center - white/silver core
    float core = 1.0 - smoothstep(0.0, 0.2, dist);

    // Soft outer glow - stays visible longer
    float glow = 1.0 - smoothstep(0.0, 0.85, dist);

    // Mix color with bright white center for hot spark effect
    vec3 finalColor = mix(vColor, vec3(1.0, 1.0, 1.0), core * 0.7);

    // Add slight blue tint to outer edges for noir effect
    finalColor = mix(finalColor, vec3(0.7, 0.7, 0.85), (1.0 - core) * 0.2);

    // Boost overall brightness
    finalColor *= 1.3;

    gl_FragColor = vec4(finalColor, vAlpha * glow);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Gas Swirl Particle Shader - Tangential particles from atmosphere shell
// ─────────────────────────────────────────────────────────────────────────────
export const gasSwirlVertexShader = `
attribute float aAlpha;
attribute float aSize;

varying float vAlpha;
varying vec3 vColor;

void main() {
    vAlpha = aAlpha;

    // Silver-blue tint matching atmosphere palette
    vColor = vec3(0.72, 0.76, 0.92);

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    // Size attenuation — larger when close, smaller far away
    gl_PointSize = aSize * (320.0 / -mvPosition.z);
    gl_PointSize = clamp(gl_PointSize, 1.5, 300.0);
}
`;

export const gasSwirlFragmentShader = `
varying float vAlpha;
varying vec3 vColor;

void main() {
    if (vAlpha <= 0.005) discard;

    vec2 coord = 2.0 * gl_PointCoord - 1.0;
    float dist = dot(coord, coord);
    if (dist > 1.0) discard;

    // Soft glow falloff - Blood Moon style (linear to 0.9)
    float glow = 1.0 - smoothstep(0.0, 0.9, dist);
    
    // Bright hot core - wider like Blood Moon
    float core = 1.0 - smoothstep(0.0, 0.25, dist);
    
    vec3 finalColor = mix(vColor, vec3(1.0, 1.0, 1.0), core * 0.6);
    finalColor *= 3.0; // High brightness for bloom

    gl_FragColor = vec4(finalColor, vAlpha * glow);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Accretion Disk Shader - High-energy swirling ring of matter
// ─────────────────────────────────────────────────────────────────────────────
export const accretionDiskVertexShader = `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const accretionDiskFragmentShader = `
uniform float uTime;
uniform float uPulseIntensity;
uniform sampler2D uNoiseMap;
varying vec2 vUv;

void main() {
    // uv.x = angle (0 to 1), uv.y = radius (0 to 1) for a RingGeometry
    float radius = vUv.y;
    float angle = vUv.x * 6.2831853;

    float speed = 1.2 + uPulseIntensity * 3.0;
    float rTime = uTime * speed;
    float spin = angle + rTime * (1.1 - radius) * 2.0;
    vec2 orbitUv = vec2(
        cos(spin) * radius * 0.95 + rTime * 0.08,
        sin(spin) * radius * 0.95 + radius * 0.45
    );
    vec2 bandUv = vec2(vUv.x * 1.6 + rTime * 0.05, radius * 4.2 - rTime * 0.03);
    vec4 noiseA = texture2D(uNoiseMap, orbitUv);
    vec4 noiseB = texture2D(uNoiseMap, bandUv);
    float plasma = noiseA.x * 0.55 + noiseA.y * 0.2 + noiseB.z * 0.25;
    float bands = sin(radius * 30.0 + plasma * 7.0 + noiseB.x * 3.0) * 0.5 + 0.5;
    
    // Edge falloff (soft inner and outer)
    float edgeFade = smoothstep(0.0, 0.15, radius) * smoothstep(1.0, 0.6, radius);
    
    // Gradient (brighter close to the event horizon)
    float intensityGrad = pow(1.0 - radius, 2.0);
    
    // Final alpha/intensity
    float intensity = (plasma * 0.6 + bands * 0.4) * edgeFade * intensityGrad;
    intensity *= (1.0 + uPulseIntensity * 3.5); // Flare up during combos
    
    // Color grading for Noir: Deep silver/blue outer, blinding white core
    vec3 colorCore = vec3(1.0, 1.0, 1.0);
    vec3 colorOuter = vec3(0.4, 0.45, 0.6);
    vec3 diskColor = mix(colorOuter, colorCore, intensity);
    
    // Doppler Beaming Effect
    // The side moving toward the camera appears brighter and bluer.
    // Assuming rotation is counter-clockwise and camera looks from positive Z.
    // Right side is approaching
    float doppler = sin(angle) * 0.5 + 0.5;
    diskColor *= 0.6 + doppler * 0.8; 
    
    // Overbright for intense bloom in HDR
    gl_FragColor = vec4(diskColor * intensity * 2.5, intensity * edgeFade * 2.0);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Chromatic Aberration Shader - RGB color fringing for cinematic effect
// ─────────────────────────────────────────────────────────────────────────────
export const ChromaticAberrationShader = {
    uniforms: {
        tDiffuse: { value: null },
        uIntensity: { value: 0.003 },
    },
    vertexShader: `
        varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uIntensity;
        varying vec2 vUv;

void main() {
            vec2 dir = vUv - 0.5;
            float dist = length(dir);

            // Stronger effect toward edges
            float aberration = uIntensity * dist * dist;

            // Sample RGB channels at slightly offset positions
            float r = texture2D(tDiffuse, vUv + dir * aberration).r;
            float g = texture2D(tDiffuse, vUv).g;
            float b = texture2D(tDiffuse, vUv - dir * aberration).b;

    gl_FragColor = vec4(r, g, b, 1.0);
}
`,
};
