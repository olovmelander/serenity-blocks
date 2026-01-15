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

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vPosition;
varying vec3 vLocalPos;
varying vec3 vViewPosition;

${noiseCommon}

// Voronoi for crater placement - creates natural random distribution
vec2 hash2(vec2 p) {
    return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}

float voronoiCraters(vec3 pos, float scale, float depth) {
    vec3 p = pos * scale;
    vec3 i = floor(p);
    vec3 f = fract(p);
    
    float res = 0.0;
    
    for(int x = -1; x <= 1; x++) {
        for(int y = -1; y <= 1; y++) {
            for(int z = -1; z <= 1; z++) {
                vec3 b = vec3(float(x), float(y), float(z));
                vec3 cellPos = i + b;
                
                // Random point in cell
                vec3 r = vec3(
                    fract(sin(dot(cellPos.xy, vec2(127.1, 311.7))) * 43758.5453),
                    fract(sin(dot(cellPos.yz, vec2(269.5, 183.3))) * 43758.5453),
                    fract(sin(dot(cellPos.xz, vec2(419.2, 371.9))) * 43758.5453)
                );
                
                vec3 toPoint = b + r - f;
                float d = length(toPoint);
                
                // Crater shape: bowl with rim
                float craterSize = 0.3 + r.x * 0.4;
                if (d < craterSize) {
                    float bowl = smoothstep(craterSize, craterSize * 0.15, d);
                    float rim = smoothstep(craterSize * 1.2, craterSize, d) * smoothstep(craterSize * 0.8, craterSize, d);
                    res += (-bowl + rim * 0.5) * depth * (0.5 + r.y * 0.5);
                }
            }
        }
    }
    
    return res;
}

// Sharp crater with visible floor and walls
float sharpCrater(vec3 pos, vec3 center, float size, float depth) {
    float d = length(pos - center);
    
    // Crater bowl - sharper edges
    float bowl = smoothstep(size, size * 0.15, d);
    
    // Raised rim
    float rim = smoothstep(size * 1.35, size * 0.95, d) * smoothstep(size * 0.8, size * 1.0, d);
    
    // Central peak (only for larger craters)
    float peak = smoothstep(size * 0.15, size * 0.02, d) * 0.5;
    
    // Terraced walls
    float walls = smoothstep(size * 0.7, size * 0.5, d) * smoothstep(size * 0.4, size * 0.6, d) * 0.2;
    
    return -bowl * depth + rim * depth * 0.7 + peak * depth * 0.4 + walls;
}

void main() {
    vec3 viewDir = normalize(vViewPosition);
    vec3 pos = normalize(vLocalPos) * 5.0;
    
    // === COSMIC NOIR COLOR PALETTE - Deep blacks with visible detail ===
    vec3 voidBlack = vec3(0.01, 0.01, 0.012);         // Near-total void
    vec3 deepCharcoal = vec3(0.03, 0.03, 0.035);      // Dark surface
    vec3 craterFloor = vec3(0.005, 0.005, 0.006);     // Nearly black crater floors
    vec3 craterRim = vec3(0.12, 0.12, 0.14);          // Visible gray rims
    vec3 craterWall = vec3(0.02, 0.02, 0.025);        // Shadowed crater walls
    vec3 highlightSilver = vec3(0.25, 0.25, 0.30);    // Rim highlights
    
    // === MARIA (DARK SEAS) ===
    float maria1 = smoothstep(0.2, 0.6, fbm(pos * 0.5 + vec3(1.5, 0.8, 0.3)));
    float maria2 = smoothstep(0.25, 0.65, fbm(pos * 0.6 + vec3(-2.0, 1.2, 0.8)));
    float maria3 = smoothstep(0.3, 0.7, fbm(pos * 0.55 + vec3(0.5, -1.5, 1.2)));
    float totalMaria = max(max(maria1, maria2 * 0.9), maria3 * 0.85);
    
    // Base color with contrast
    vec3 baseColor = mix(deepCharcoal, voidBlack, totalMaria);
    
    // === MAJOR IMPACT CRATERS (Visible) ===
    float majorCraters = 0.0;
    majorCraters += sharpCrater(pos, vec3(2.2, 0.5, 0.8), 1.4, 0.6);
    majorCraters += sharpCrater(pos, vec3(-1.5, 1.5, 1.0), 1.2, 0.55);
    majorCraters += sharpCrater(pos, vec3(0.5, -1.8, 1.3), 1.1, 0.5);
    majorCraters += sharpCrater(pos, vec3(-0.8, 0.2, -2.0), 1.3, 0.55);
    majorCraters += sharpCrater(pos, vec3(1.8, -0.8, 1.5), 1.0, 0.48);
    majorCraters += sharpCrater(pos, vec3(-2.0, -1.0, 0.8), 1.15, 0.52);
    majorCraters += sharpCrater(pos, vec3(0.3, 2.3, 0.5), 1.05, 0.5);
    majorCraters += sharpCrater(pos, vec3(-0.5, -0.5, 2.3), 0.95, 0.45);
    majorCraters += sharpCrater(pos, vec3(1.2, 1.2, 1.8), 0.9, 0.42);
    
    // === MEDIUM CRATERS ===
    float medCraters = 0.0;
    medCraters += sharpCrater(pos, vec3(1.5, 0.0, 2.0), 0.6, 0.35);
    medCraters += sharpCrater(pos, vec3(-1.0, 1.8, 1.2), 0.55, 0.32);
    medCraters += sharpCrater(pos, vec3(0.8, -1.2, 1.8), 0.5, 0.3);
    medCraters += sharpCrater(pos, vec3(-0.3, -1.5, 1.6), 0.58, 0.33);
    medCraters += sharpCrater(pos, vec3(2.0, 1.0, 0.5), 0.52, 0.31);
    medCraters += sharpCrater(pos, vec3(-1.8, 0.5, 1.5), 0.48, 0.28);
    medCraters += sharpCrater(pos, vec3(0.5, 1.5, 1.8), 0.55, 0.32);
    medCraters += sharpCrater(pos, vec3(-0.8, -0.8, 2.0), 0.5, 0.3);
    
    // === VORONOI SMALL CRATERS ===
    float smallCraters = voronoiCraters(pos, 3.0, 0.25);
    float tinyCraters = voronoiCraters(pos, 6.0, 0.12);
    float microCraters = voronoiCraters(pos, 12.0, 0.06);
    
    float allCraters = majorCraters + medCraters + smallCraters + tinyCraters + microCraters;
    
    // === SURFACE TEXTURE ===
    float roughLarge = fbm(pos * 4.0) * 0.08;
    float roughMed = fbm(pos * 10.0) * 0.04;
    float roughFine = snoise(pos * 25.0) * 0.02;
    float totalRough = roughLarge + roughMed + roughFine;
    
    // === APPLY CRATER EFFECTS TO COLOR ===
    // Deep crater floors (very dark)
    float floorDepth = max(0.0, -allCraters * 4.0);
    baseColor = mix(baseColor, craterFloor, smoothstep(0.0, 1.0, floorDepth) * 0.9);
    
    // Crater walls (medium darkness)
    float wallFactor = max(0.0, -allCraters * 2.0) * (1.0 - floorDepth);
    baseColor = mix(baseColor, craterWall, wallFactor * 0.6);
    
    // Visible crater rims (catch light)
    float rimBrightness = max(0.0, allCraters * 3.5);
    baseColor = mix(baseColor, craterRim, smoothstep(0.0, 0.8, rimBrightness) * 0.7);
    
    // Surface roughness adds variation
    baseColor += vec3(totalRough * 0.3);
    
    // === DRAMATIC LIGHTING ===
    vec3 lightDir = normalize(vec3(0.6, 0.5, 0.6));
    
    // Calculate surface normal from height
    float eps = 0.08;
    float hCenter = allCraters + totalRough;
    float hRight = sharpCrater(pos + vec3(eps, 0.0, 0.0), vec3(0.0), 0.5, 0.3) + fbm((pos + vec3(eps, 0.0, 0.0)) * 4.0) * 0.1;
    float hUp = sharpCrater(pos + vec3(0.0, eps, 0.0), vec3(0.0), 0.5, 0.3) + fbm((pos + vec3(0.0, eps, 0.0)) * 4.0) * 0.1;
    float hForward = sharpCrater(pos + vec3(0.0, 0.0, eps), vec3(0.0), 0.5, 0.3) + fbm((pos + vec3(0.0, 0.0, eps)) * 4.0) * 0.1;
    
    vec3 surfaceNormal = normalize(vNormal + vec3(
        (hCenter - hRight) * 8.0,
        (hCenter - hUp) * 8.0,
        (hCenter - hForward) * 8.0
    ));
    
    // Strong directional light
    float diffuse = max(0.0, dot(surfaceNormal, lightDir));
    diffuse = pow(diffuse, 0.9);
    
    // Ambient occlusion in craters
    float ao = 1.0 - floorDepth * 0.5;
    
    // Final lighting - still dark but with visible detail
    float lighting = 0.08 + diffuse * 0.5 * ao;
    
    // Specular on rims only
    vec3 reflectDir = reflect(-lightDir, surfaceNormal);
    float spec = pow(max(0.0, dot(reflectDir, viewDir)), 32.0);
    spec *= rimBrightness * 0.3;
    
    vec3 litColor = baseColor * lighting + vec3(0.5, 0.5, 0.55) * spec;
    
    // === NOIR RIM GLOW - Silver/white edge light ===
    float fresnel = pow(1.0 - abs(dot(vNormal, viewDir)), 3.5);
    vec3 rimGlow = vec3(0.6, 0.6, 0.65);
    float rimIntensity = 0.5 + uPulseIntensity * 0.4;
    litColor += rimGlow * fresnel * rimIntensity * uGlowIntensity;
    
    // === SUBTLE ANIMATION ===
    float shimmer = snoise(pos * 6.0 + vec3(uTime * 0.15, 0.0, uTime * 0.12));
    if (shimmer > 0.7) {
        litColor += vec3(0.04) * (shimmer - 0.7) * 2.0;
    }
    
    // === GAMEPLAY PULSE ===
    float pulse = sin(uTime * 1.2) * 0.03 + 1.0;
    litColor *= pulse * (1.0 + uPulseIntensity * 0.3);
    
    // Boost contrast slightly
    litColor = pow(litColor, vec3(0.95));
    
    // Keep noir aesthetic but allow some brightness for detail
    litColor = clamp(litColor, 0.0, 0.5);
    
    gl_FragColor = vec4(litColor, 1.0);
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
    uniform float uOpacity;
    uniform float uPulse;
    varying vec2 vUv;

    void main() {
        vec4 texColor = texture2D(tDiffuse, vUv);

        // Aggressive edge fade to hide plane boundaries and blend properly
        float fadeX = smoothstep(0.0, 0.4, vUv.x) * smoothstep(1.0, 0.6, vUv.x);
        float fadeY = smoothstep(0.0, 0.4, vUv.y) * smoothstep(1.0, 0.6, vUv.y);
        float fade = fadeX * fadeY;
        fade = pow(fade, 1.5);

        // Desaturate to ensure pure black/white noir look (just in case texture has color)
        float gray = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));
        vec3 color = vec3(gray);

        // Pulse effect boosts brightness
        float pulseFactor = 1.0 + uPulse * 0.3;
        color *= pulseFactor;

        // Final alpha combines texture alpha, master opacity, and edge fade
        float alpha = texColor.r * (uOpacity + uPulse * 0.05) * fade * 1.5; // Boost visibility slightly

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

varying vec3 vNormal;
varying vec3 vPosition;
varying vec3 vViewPosition;

${noiseCommon}

void main() {
    vec3 viewDir = normalize(vViewPosition);
    vec3 pos = normalize(vPosition) * 4.0;

    // View dependency for rim softness
    float fresnel = 1.0 - abs(dot(vNormal, viewDir));
    fresnel = pow(fresnel, 2.0);

    // === EPIC GAS EXPLOSION EFFECT ===
    float explosionAge = uExplosionTimer;
    float explosionFactor = 0.0;
    float explosionTurbulence = 0.0;
    float explosionGlow = 0.0;
    float shockwaveRing = 0.0;
    float gasTendrils = 0.0;
    float energyPulse = 0.0;
    
    if (explosionAge > 0.0 && explosionAge < 4.0) {
        // Explosion phases with smoother transitions
        float ignition = smoothstep(0.0, 0.15, explosionAge) * smoothstep(0.5, 0.2, explosionAge);
        float expansion = smoothstep(0.2, 0.8, explosionAge) * smoothstep(2.5, 1.0, explosionAge);
        float dissipation = smoothstep(2.0, 4.0, explosionAge);
        
        explosionFactor = ignition * 1.5 + expansion;
        explosionTurbulence = (1.0 - dissipation) * uExplosionIntensity * 1.5;
        explosionGlow = ignition * 3.0 + expansion * 1.5;
        
        // === EXPANDING SHOCKWAVE RINGS ===
        // Multiple concentric rings that expand outward
        float ringRadius1 = explosionAge * 2.5;
        float ringRadius2 = max(0.0, explosionAge - 0.3) * 2.8;
        float ringRadius3 = max(0.0, explosionAge - 0.6) * 3.2;
        
        // Distance from center in spherical space
        float distFromCenter = length(pos.xy); 
        
        // Create ring shapes with thickness
        float ring1 = smoothstep(ringRadius1 - 0.4, ringRadius1, distFromCenter) * 
                      smoothstep(ringRadius1 + 0.4, ringRadius1, distFromCenter);
        float ring2 = smoothstep(ringRadius2 - 0.3, ringRadius2, distFromCenter) * 
                      smoothstep(ringRadius2 + 0.3, ringRadius2, distFromCenter);
        float ring3 = smoothstep(ringRadius3 - 0.25, ringRadius3, distFromCenter) * 
                      smoothstep(ringRadius3 + 0.25, ringRadius3, distFromCenter);
        
        // Fade rings as they expand
        ring1 *= smoothstep(8.0, 0.0, ringRadius1);
        ring2 *= smoothstep(10.0, 0.0, ringRadius2) * 0.7;
        ring3 *= smoothstep(12.0, 0.0, ringRadius3) * 0.5;
        
        shockwaveRing = (ring1 + ring2 + ring3) * uExplosionIntensity;
        
        // === GAS TENDRILS SHOOTING OUTWARD ===
        // Create directional wisps that burst from center
        float tendrilAngle = atan(pos.y, pos.x);
        float tendrilNoise = snoise(vec3(tendrilAngle * 4.0, explosionAge * 3.0, 0.0));
        float tendrilShape = pow(abs(sin(tendrilAngle * 8.0 + tendrilNoise * 2.0)), 4.0);
        
        // Tendrils expand outward
        float tendrilLength = explosionAge * 3.0;
        float tendrilDist = smoothstep(0.0, tendrilLength, distFromCenter) * 
                           smoothstep(tendrilLength + 1.0, tendrilLength * 0.5, distFromCenter);
        
        gasTendrils = tendrilShape * tendrilDist * (1.0 - dissipation) * uExplosionIntensity;
        
        // === PULSATING ENERGY WAVES ===
        float pulseWave = sin(explosionAge * 15.0 - distFromCenter * 2.0) * 0.5 + 0.5;
        energyPulse = pulseWave * explosionFactor * 0.4 * (1.0 - dissipation);
    }

    // === LIVING ATMOSPHERE SIMULATION ===
    // We displace the coordinate system over time to create swirling flow
    // ACCELERATED MOVEMENT: Increased speeds significantly to ensure visibility
    float t = uTime * 0.8; 
    float turbulenceSpeed = 1.0 + explosionTurbulence * 8.0;
    float turbulenceScale = 1.0 + explosionTurbulence * 0.5;

    // 1. ROTATIONAL FLOW (Planetary Spin)
    // Rotate coordinates around Y axis - faster spin
    float sinT = sin(t * 0.5);
    float cosT = cos(t * 0.5);
    mat2 rot = mat2(cosT, -sinT, sinT, cosT);
    
    vec3 flowPos = pos;
    flowPos.xz = rot * flowPos.xz; 

    // 2. MULTI-LAYERED FLUID NOISE
    
    // Layer 1: Deep currents (Slow, large scale) - increased scroll speed
    // Moves with the rotation
    float gasDeep = fbm(flowPos * 1.6 * turbulenceScale + vec3(0.0, t * 0.4, explosionAge * 3.0));
    
    // Layer 2: Surface Turbulence (Medium scale, counter-movement)
    // We add a counter-flow vector to create shearing/eddies
    vec3 counterFlow = vec3(sin(t * 0.8), cos(t * 0.6), 0.0) * 0.5;
    float gasSurface = snoise(pos * 3.5 * turbulenceScale + counterFlow + vec3(0.0, -t * 0.7 * turbulenceSpeed, explosionAge * 2.0));
    
    // Layer 3: Ethereal Wisps (High frequency, vertical drift) - fast drift
    float gasWisps = snoise(pos * 7.0 + vec3(t * 0.5, -t * 1.5, explosionAge * 5.0));
    
    // 3. COMPOSITION
    // Combine layers: Deep structure + Surface detail + Wisps
    // Use the surface layer to distort the deep layer slightly (domain warping)
    float gasCombined = gasDeep + gasSurface * 0.35 + gasWisps * 0.15;
    
    // 4. BREATHING EFFECT
    // More noticeable density pulse
    float breath = 1.0 + sin(uTime * 1.2) * 0.12; 
    gasCombined *= breath;
    
    // Explosion shockwave distortion (preserved)
    float shockwaveNoise = snoise(pos * 6.0 + vec3(explosionAge * 12.0));
    float burstNoise = snoise(pos * 3.0 - vec3(explosionAge * 5.0, 0.0, explosionAge * 3.0));
    
    // Mix it all
    gasCombined += (shockwaveNoise + burstNoise) * explosionFactor * 0.6;
    gasCombined += (gasWisps * 0.5) * explosionTurbulence; // Add grit during explosion

    float gas = gasCombined;

    // === DRAMATIC COLOR PALETTE ===
    vec3 colorDense = vec3(0.12, 0.12, 0.15);      // Dark noir base
    vec3 colorWispy = vec3(0.35, 0.35, 0.42);      // Silver mist
    
    // Explosion color gradient: hot white → bright silver → cool cyan tint
    vec3 colorHotCore = vec3(1.0, 1.0, 1.0);       // Pure white (hottest)
    vec3 colorExplosion = vec3(0.95, 0.95, 1.0);   // Bright silver-white
    vec3 colorEnergy = vec3(0.7, 0.8, 0.95);       // Cool silver-cyan
    vec3 colorTendril = vec3(0.5, 0.55, 0.7);      // Blue-gray tendril
    vec3 colorRing = vec3(0.9, 0.92, 1.0);         // Shockwave ring color
    
    vec3 finalColor = mix(colorDense, colorWispy, gas);
    
    // Add explosion glow (hot core)
    finalColor = mix(finalColor, colorHotCore, explosionGlow * 0.35);
    finalColor = mix(finalColor, colorExplosion, explosionFactor * 0.4);
    
    // Add shockwave rings with bright color
    finalColor = mix(finalColor, colorRing, shockwaveRing * 0.7);
    
    // Add gas tendrils
    finalColor = mix(finalColor, colorTendril, gasTendrils * 0.5);
    
    // Add energy pulse with cyan tint
    finalColor = mix(finalColor, colorEnergy, energyPulse * 0.3);
    
    // Boost brightness during peak explosion
    finalColor *= 1.0 + explosionGlow * 0.3;

    // Pulse effect
    finalColor *= (1.0 + uPulseIntensity * 0.5);

    // Opacity logic - transparent in middle, opaque at edges (gas atmosphere feel)
    float density = smoothstep(0.2, 0.8, gas);
    float alpha = density * 0.4 + fresnel * 0.5;
    
    // Explosion dramatically boosts opacity (atmosphere "ignites")
    alpha += explosionFactor * 0.65 * uExplosionIntensity;
    alpha += shockwaveRing * 0.5;  // Shockwave rings are visible
    alpha += gasTendrils * 0.4;    // Tendrils are visible
    alpha = min(alpha, 0.98);

    // Soften occlusion
    alpha *= smoothstep(0.0, 0.2, fresnel + 0.1);

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


