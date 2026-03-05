/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  🌑 BLOOD MOON SHADERS 🌑
 *  Custom GLSL shaders for the Blood Moon 3D Theme
 * ═══════════════════════════════════════════════════════════════════════════════
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
// Blood Moon Core Shader - Pulsing crimson moon with craters
// ─────────────────────────────────────────────────────────────────────────────
export const moonVertexShader = `
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

export const moonFragmentShader = `
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
    
    // === DEEP BLOOD RED COLOR PALETTE ===
    vec3 brightHighland = vec3(0.50, 0.05, 0.08);    // Subdued blood red
    vec3 darkMaria = vec3(0.14, 0.015, 0.025);       // Very dark blood maria
    vec3 craterFloor = vec3(0.03, 0.002, 0.005);     // Near-black crater floors
    vec3 craterRim = vec3(0.70, 0.12, 0.16);         // Crimson rims (toned down)
    vec3 craterWall = vec3(0.25, 0.02, 0.04);        // Shadowed crater walls
    
    // === PRONOUNCED MARIA (DARK SEAS) ===
    float maria1 = smoothstep(0.2, 0.6, fbm(pos * 0.5 + vec3(1.5, 0.8, 0.3)));
    float maria2 = smoothstep(0.25, 0.65, fbm(pos * 0.6 + vec3(-2.0, 1.2, 0.8)));
    float maria3 = smoothstep(0.3, 0.7, fbm(pos * 0.55 + vec3(0.5, -1.5, 1.2)));
    float totalMaria = max(max(maria1, maria2 * 0.9), maria3 * 0.85);
    
    // Base color with strong contrast
    vec3 baseColor = mix(brightHighland, darkMaria, totalMaria);
    
    // === MAJOR IMPACT CRATERS (Very visible, enlarged) ===
    float majorCraters = 0.0;
    majorCraters += sharpCrater(pos, vec3(2.2, 0.5, 0.8), 1.9, 0.75);   // Large prominent crater
    majorCraters += sharpCrater(pos, vec3(-1.5, 1.5, 1.0), 1.7, 0.70);
    majorCraters += sharpCrater(pos, vec3(0.5, -1.8, 1.3), 1.5, 0.65);
    majorCraters += sharpCrater(pos, vec3(-0.8, 0.2, -2.0), 1.8, 0.70);
    majorCraters += sharpCrater(pos, vec3(1.8, -0.8, 1.5), 1.4, 0.62);
    majorCraters += sharpCrater(pos, vec3(-2.0, -1.0, 0.8), 1.6, 0.68);
    majorCraters += sharpCrater(pos, vec3(0.3, 2.3, 0.5), 1.45, 0.65);
    majorCraters += sharpCrater(pos, vec3(-0.5, -0.5, 2.3), 1.35, 0.58);
    majorCraters += sharpCrater(pos, vec3(1.2, 1.2, 1.8), 1.3, 0.55);

    // === MEDIUM CRATERS (enlarged) ===
    float medCraters = 0.0;
    medCraters += sharpCrater(pos, vec3(1.5, 0.0, 2.0), 0.85, 0.45);
    medCraters += sharpCrater(pos, vec3(-1.0, 1.8, 1.2), 0.80, 0.42);
    medCraters += sharpCrater(pos, vec3(0.8, -1.2, 1.8), 0.75, 0.40);
    medCraters += sharpCrater(pos, vec3(-0.3, -1.5, 1.6), 0.82, 0.43);
    medCraters += sharpCrater(pos, vec3(2.0, 1.0, 0.5), 0.78, 0.41);
    medCraters += sharpCrater(pos, vec3(-1.8, 0.5, 1.5), 0.70, 0.38);
    medCraters += sharpCrater(pos, vec3(0.5, 1.5, 1.8), 0.80, 0.42);
    medCraters += sharpCrater(pos, vec3(-0.8, -0.8, 2.0), 0.75, 0.40);

    // === VORONOI SMALL CRATERS (Distributed naturally, bigger) ===
    float smallCraters = voronoiCraters(pos, 2.2, 0.35);
    float tinyCraters = voronoiCraters(pos, 4.5, 0.18);
    float microCraters = voronoiCraters(pos, 10.0, 0.08);
    
    float allCraters = majorCraters + medCraters + smallCraters + tinyCraters + microCraters;
    
    // === SURFACE TEXTURE ===
    float roughLarge = fbm(pos * 4.0) * 0.12;
    float roughMed = fbm(pos * 10.0) * 0.06;
    float roughFine = snoise(pos * 25.0) * 0.03;
    float roughMicro = snoise(pos * 50.0) * 0.015;
    float totalRough = roughLarge + roughMed + roughFine + roughMicro;
    
    // === APPLY CRATER EFFECTS TO COLOR ===
    // Deep crater floors (very dark — stronger multiplier for blacker pits)
    float floorDepth = max(0.0, -allCraters * 5.5);
    baseColor = mix(baseColor, craterFloor, smoothstep(0.0, 0.8, floorDepth) * 0.95);
    
    // Crater walls (medium darkness)
    float wallFactor = max(0.0, -allCraters * 2.0) * (1.0 - floorDepth);
    baseColor = mix(baseColor, craterWall, wallFactor * 0.6);
    
    // Bright crater rims (catch light)
    float rimBrightness = max(0.0, allCraters * 3.5);
    baseColor = mix(baseColor, craterRim, smoothstep(0.0, 0.8, rimBrightness) * 0.7);
    
    // Surface roughness adds variation — clamp to prevent negatives in deep craters
    baseColor = max(baseColor + vec3(totalRough * 0.5, totalRough * 0.08, totalRough * 0.1), vec3(0.0));
    
    // === DRAMATIC LIGHTING ===
    vec3 lightDir = normalize(vec3(0.6, 0.5, 0.6));
    
    // Calculate surface normal from height (using just rough fbm for bump mapping)
    float eps = 0.08;
    float bumpCenter = fbm(pos * 4.0) * 0.1;
    float bumpRight = fbm((pos + vec3(eps, 0.0, 0.0)) * 4.0) * 0.1;
    float bumpUp = fbm((pos + vec3(0.0, eps, 0.0)) * 4.0) * 0.1;
    float bumpForward = fbm((pos + vec3(0.0, 0.0, eps)) * 4.0) * 0.1;
    
    vec3 surfaceNormal = normalize(vNormal + vec3(
        (bumpCenter - bumpRight) * 8.0,
        (bumpCenter - bumpUp) * 8.0,
        (bumpCenter - bumpForward) * 8.0
    ));
    
    // Strong directional light
    float diffuse = max(0.0, dot(surfaceNormal, lightDir));
    diffuse = pow(diffuse, 0.8); // Slightly soften
    
    // Ambient occlusion in craters
    float ao = 1.0 - floorDepth * 0.5;
    
    // Final lighting
    float lighting = 0.15 + diffuse * 0.85 * ao;
    
    // Specular on rims only
    vec3 reflectDir = reflect(-lightDir, surfaceNormal);
    float spec = pow(max(0.0, dot(reflectDir, viewDir)), 32.0);
    spec *= rimBrightness * 0.4 * smoothstep(0.0, 0.2, diffuse);
    
    vec3 litColor = baseColor * lighting + vec3(0.9, 0.15, 0.2) * spec;
    
    // === EPIC BLOOD MOON RIM GLOW ===
    // Much sharper and tighter fresnel for atmospheric edge, plus a softer inner rim
    float fresnelTight = pow(clamp(1.0 - abs(dot(vNormal, viewDir)), 0.0, 1.0), 5.0);
    float fresnelWide = pow(clamp(1.0 - abs(dot(vNormal, viewDir)), 0.0, 1.0), 1.5);
    vec3 rimGlowHot = vec3(1.0, 0.3, 0.1); // Fiery hot rim
    vec3 rimGlowSoft = vec3(0.6, 0.0, 0.05); // Deep red bleed
    
    // Add intense rim lighting
    litColor += rimGlowHot * fresnelTight * (2.0 + uPulseIntensity * 2.0) * uGlowIntensity;
    litColor += rimGlowSoft * fresnelWide * (0.8 + uPulseIntensity * 0.8) * uGlowIntensity;
    
    // === SUBTLE ANIMATION ===
    float shimmer = snoise(pos * 6.0 + vec3(uTime * 0.2, 0.0, uTime * 0.15));
    if (shimmer > 0.7) {
        litColor += vec3(0.18, 0.02, 0.03) * (shimmer - 0.7) * 3.0;
    }
    
    // === GAMEPLAY PULSE ===
    float pulse = sin(uTime * 1.5) * 0.06 + 1.0;
    litColor *= pulse * (1.0 + uPulseIntensity * 0.4);
    
    // Boost overall contrast — darker gamma for moodier moon
    litColor = pow(max(litColor, vec3(0.0)), vec3(1.1));

    // Ensure we don't wash out
    litColor = clamp(litColor, 0.0, 1.2);
    
    gl_FragColor = vec4(litColor, 1.0);
}
`;
// ─────────────────────────────────────────────────────────────────────────────
// Blood Wave Shader - Expanding crimson rings
// ─────────────────────────────────────────────────────────────────────────────
export const waveVertexShader = `
uniform float uTime;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;

${noiseCommon}

void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    
    // Violent energy displacement
    vec3 pos = position;
    float noise = snoise(pos * 0.15 + uTime * 6.0) * 3.0;
    pos += normal * noise;
    
    vec4 worldPos = modelMatrix * vec4(pos, 1.0);
    vWorldPosition = worldPos.xyz;
    
    gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

export const waveFragmentShader = `
uniform float uTime;
uniform float uOpacity;
uniform vec3 uColor;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;

${noiseCommon}

void main() {
    // Dynamic plasma/energy effect
    float noiseVal = snoise(vWorldPosition * 0.08 - uTime * 4.0);
    
    // Intense energy core based on view angle and noise
    float intensity = pow(clamp(0.8 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 0.0, 1.0), 1.5);
    intensity += noiseVal * 0.3;
    
    vec3 energyColor = mix(uColor, vec3(1.0, 0.8, 0.3), intensity * 0.6); // Hot core
    
    // Fade out edges smoothly
    float alpha = uOpacity * smoothstep(-0.1, 0.8, intensity);
    alpha = pow(alpha, 1.2); // Sharper fade
    
    gl_FragColor = vec4(energyColor * (1.0 + intensity * 1.5), alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Particle Shader - Soft glowing particles
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
    float angle = uTime * 0.1 * (1.0 + aRandom * 0.5);
    float s = sin(angle);
    float c = cos(angle);
    vec3 rotatedPos = vec3(pos.x * c - pos.z * s, pos.y, pos.x * s + pos.z * c);
    
    // Vertical float
    rotatedPos.y += sin(uTime * 0.5 + aRandom * 10.0) * 0.5;
    
    vec4 mvPosition = modelViewMatrix * vec4(rotatedPos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    
    // Size with attenuation - minimum 4px for visibility
    gl_PointSize = max(4.0, aSize * (200.0 / -mvPosition.z));
    
    // Pulsing alpha
    vAlpha = 0.4 + 0.4 * sin(uTime * 2.0 + aRandom * 10.0);
    
    // Color variation (reds to magentas)
    vColor = vec3(0.8 + aRandom * 0.2, 0.1, 0.15 + aRandom * 0.1);
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
// Star Shader - Round, atmospheric twinkling stars with uniform speed
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
// Blood Spark Shader - Explosive burst from moon surface outward
// ─────────────────────────────────────────────────────────────────────────────
export const bloodSparkVertexShader = `
uniform float time;
uniform float uPulseTimer;

attribute float aTheta;
attribute float aPhi;
attribute float aRadius;
attribute float aRandom;
attribute vec3 aColor;

varying vec3 vColor;
varying float vAlpha;
varying float vAgeRatio;
varying float vRandom;

void main() {
    // Initial position on moon surface
    vec3 initialPos;
    initialPos.x = aRadius * sin(aPhi) * cos(aTheta);
    initialPos.y = aRadius * sin(aPhi) * sin(aTheta);
    initialPos.z = aRadius * cos(aPhi);

    vec3 radialDir = normalize(initialPos);

    // Stagger eruption timing based on random value
    float triggerTime = aRandom * 1.5;
    float age = uPulseTimer - triggerTime;

    vec3 animatedPos = initialPos;
    float alpha = 0.0;
    float size = 0.0;
    float ageRatio = 0.0;

    // Effect parameters — longer life so particles reach deep space
    float maxLife = 200.0 + aRandom * 120.0;

    if (age > 0.0 && age < maxLife) {
        ageRatio = age / maxLife;

        // Random spread for varied explosion directions
        float spreadX = (aRandom - 0.5) * 0.8;
        float spreadY = (fract(aRandom * 7.0) - 0.5) * 0.8;
        float spreadZ = (fract(aRandom * 13.0) - 0.5) * 0.8;
        vec3 burstDir = normalize(radialDir + vec3(spreadX, spreadY, spreadZ));

        // Fast outward burst, slower decay so they keep drifting into space
        float t = age;
        float driftFactor = 1.0 - exp(-t * 0.02);
        animatedPos += burstDir * (400.0 + aRandom * 600.0) * driftFactor;

        // Upward convection carries particles further
        animatedPos.y += pow(ageRatio, 2.0) * 250.0 * (aRandom - 0.2);

        // Alpha peaks quickly then fades out slowly
        alpha = smoothstep(0.0, 0.05, ageRatio) * (1.0 - pow(ageRatio, 2.0));

        // Sizes - power law distribution for a few massive chunks and many tiny sparks
        float sizeCurve = pow(aRandom, 2.5);
        size = mix(10.0, 90.0, sizeCurve);

        // Shrink slightly as they cool off
        size *= (1.0 - ageRatio * 0.5);
    }

    vec4 mvPosition = modelViewMatrix * vec4(animatedPos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    gl_PointSize = size * (350.0 / -mvPosition.z);
    gl_PointSize = clamp(gl_PointSize, 2.0, 180.0);

    vColor = aColor;
    vAlpha = alpha;
    vAgeRatio = ageRatio;
    vRandom = aRandom;
}
`;

export const bloodSparkFragmentShader = `
varying vec3 vColor;
varying float vAlpha;
varying float vAgeRatio;
varying float vRandom;

void main() {
    if (vAlpha <= 0.01) discard;

    vec2 circCoord = 2.0 * gl_PointCoord - 1.0;
    float dist = dot(circCoord, circCoord);
    if (dist > 1.0) discard;

    // Hot bright core (white/yellow) that quickly cools down over age
    float coreTemp = clamp(1.0 - (vAgeRatio * (2.0 + vRandom)), 0.0, 1.0);
    vec3 hotColor = mix(vec3(1.0, 0.9, 0.6), vec3(1.0, 0.4, 0.1), 1.0 - coreTemp); 
    
    float coreRadius = 0.2 * coreTemp;
    float coreIntensity = 1.0 - smoothstep(0.0, coreRadius, sqrt(dist));

    // Soft outer glow - Deep reds
    float glow = 1.0 - smoothstep(0.0, 0.9, sqrt(dist));

    // Base particle color, getting darker as it ages
    vec3 baseCol = vColor * mix(2.0, 0.3, vAgeRatio); 
    
    // Add hot core directly into the base color
    vec3 finalColor = mix(baseCol, hotColor, coreIntensity * coreTemp * 1.5);

    // Give it punch
    finalColor *= (1.0 + coreTemp);
    
    gl_FragColor = vec4(finalColor, vAlpha * glow);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Nebula Shader - Texture based with soft edge fade
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
    uniform float uTime;
    varying vec2 vUv;
    
    ${noiseCommon}

    void main() {
        // Fluid billowy distortion across UVs
        float distortX = fbm(vec3(vUv * 2.0, uTime * 0.05)) * 0.1;
        float distortY = fbm(vec3(vUv * 2.0 + 10.0, uTime * 0.05)) * 0.1;
        vec2 distortedUv = vUv + vec2(distortX, distortY);
        
        vec4 texColor = texture2D(tDiffuse, distortedUv);

        // Aggressive edge fade to hide plane boundaries
        float fadeX = smoothstep(0.0, 0.4, distortedUv.x) * smoothstep(1.0, 0.6, distortedUv.x);
        float fadeY = smoothstep(0.0, 0.4, distortedUv.y) * smoothstep(1.0, 0.6, distortedUv.y);
        float fade = fadeX * fadeY;
        fade = pow(clamp(fade, 0.0, 1.0), 1.5);

        // Pulse effect
        float alpha = texColor.a * (uOpacity + uPulse * 0.1) * fade;
        
        // Enhance highlights based on distortion gradients to simulate gas volume catching light
        float volHi = smoothstep(0.0, 0.05, distortX) * 0.5 * texColor.r;
        vec3 color = texColor.rgb * (1.0 + uPulse * 0.3) + vec3(volHi, volHi * 0.2, volHi * 0.1);

        gl_FragColor = vec4(color, alpha);
    }
`;
