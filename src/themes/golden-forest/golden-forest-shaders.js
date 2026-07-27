/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  🌲 GOLDEN FOREST SHADERS 🌲
 *  Custom GLSL shaders for the Golden Forest 3D Theme
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
uniform vec3 uMossColor; // Acts as Sunlight/Highlight
uniform vec3 uDirtColor; // Acts as Shadow/Foreground
uniform float uGlowIntensity;
uniform vec3 uFogColor;

varying vec2 vUv;
varying vec3 vWorldPos;
varying float vDepth;

${noiseCommon}

void main() {
    // 1. Distorted UVs for painterly effect
    vec2 p = vUv * 8.0; // Scale of texture
    
    // Add some "warp" to the coordinates using low freq noise
    float warp = snoise(vec3(p * 0.5, 0.0)); 
    p += warp * 0.5;

    // 2. Large Scale Pattern (The "Blobs" / Brush strokes)
    float pattern = snoise(vec3(p, 0.0));
    
    // 3. Depth Gradient (The "Lighting")
    // Map depth to 0-1 range. 
    // Near (0) -> Depth ~10. Far (1) -> Depth ~100.
    float depthFactor = smoothstep(10.0, 90.0, vDepth);
    
    // 4. Color Mixing
    
    // Start with base ground color
    vec3 finalColor = uGroundColor;
    
    // Mix in SHADOW (Dirt Color) based on:
    // - Being near the camera (1.0 - depthFactor)
    // - Pattern noise (to break up straight lines)
    float shadowMix = (1.0 - depthFactor) * 1.2 + pattern * 0.2;
    shadowMix = clamp(shadowMix, 0.0, 1.0);
    finalColor = mix(finalColor, uDirtColor, smoothstep(0.2, 0.9, shadowMix));
    
    // Mix in SUNLIGHT (Moss Color) based on:
    // - Being far away (depthFactor)
    // - Pattern noise
    float sunMix = depthFactor * 1.2 - pattern * 0.1; 
    sunMix = clamp(sunMix, 0.0, 1.0);
    
    // Firewatch ground often looks "burned" or glowing in distance
    // We mix nicely into the golden highlight
    finalColor = mix(finalColor, uMossColor, smoothstep(0.3, 1.0, sunMix));

    // 5. Stylized Hard Edges (Optional, but adds to the "Vector Art" feel)
    // We can sharpen the transition slightly if it's too blurry
    // (Left soft for now as standard Firewatch terrain is often soft gradients)

    // 6. Atmospheric Fog integration
    // Standard fog might wash it out too much, so we do a custom blend
    // to keep the colors rich.
    
    float fogStrength = smoothstep(40.0, 150.0, vDepth);
    finalColor = mix(finalColor, uFogColor, fogStrength * 0.8); // 0.8 max fog to keep some color
    
    // 7. Event Glow
    finalColor += vec3(1.0, 0.8, 0.4) * uGlowIntensity * 0.3;

    gl_FragColor = vec4(finalColor, 1.0);
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
// VOLUMETRIC GOD RAY SHADER - Advanced light scattering simulation
// ─────────────────────────────────────────────────────────────────────────────
export const godRayVertexShader = `
varying vec2 vUv;
varying vec3 vWorldPos;

void main() {
    vUv = uv;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPosition.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const godRayFragmentShader = `
uniform float uTime;
uniform float uOpacity;
uniform vec3 uSunPosition;
uniform vec3 uRayColor;
uniform vec2 uResolution;
uniform vec2 uSunScreenPos;

varying vec2 vUv;
varying vec3 vWorldPos;

${noiseCommon}

// Soft beam function - creates individual ray beams
float rayBeam(vec2 uv, float angle, float width, float softness) {
    // Rotate UV around sun center (CENTERED)
    vec2 center = uSunScreenPos;
    vec2 p = uv - center;
    
    float c = cos(angle);
    float s = sin(angle);
    vec2 rotUV = vec2(p.x * c - p.y * s, p.x * s + p.y * c);

    // Distance from ray center line
    float dist = abs(rotUV.x);

    // Tapered ends (rectangular shafts that narrow with distance from source)
    float along = clamp(rotUV.y + 0.45, 0.0, 1.0);
    float taperedWidth = mix(width * 1.35, width * 0.45, along);

    // Soft-edged beam
    float beam = smoothstep(taperedWidth, taperedWidth * softness, dist);

    // Segment mask keeps rays as downward shafts with soft end falloff
    float segment = smoothstep(-0.18, 0.02, rotUV.y) * (1.0 - smoothstep(0.98, 1.22, rotUV.y));

    // Fade with distance from sun
    float lengthFade = 1.0 - smoothstep(0.0, 0.8, length(p));

    // Full 360 degrees visibility (removed directional mask)
    // But we focus on downward rays by keeping the angles as they are
    
    return beam * lengthFade * segment;
}

void main() {
    vec2 uv = vUv;

    // Sun position in UV space (projected from world in theme animation update)
    vec2 sunUV = clamp(uSunScreenPos, vec2(0.04), vec2(0.96));
    vec2 toSun = sunUV - uv;
    float distToSun = length(toSun);
    
    // ═══════════════════════════════════════════════════════════════════════
    // VOLUMETRIC RAY ACCUMULATION
    // ═══════════════════════════════════════════════════════════════════════

    float rays = 0.0;

    // Create multiple ray beams at different angles
    // WIDER and more INTENSE rays for visibility through forest
    float rayAngles[7];
    rayAngles[0] = -0.40;   // Wider spread
    rayAngles[1] = -0.22;
    rayAngles[2] = -0.08;
    rayAngles[3] = 0.0;
    rayAngles[4] = 0.10;
    rayAngles[5] = 0.25;
    rayAngles[6] = 0.45;    // Wider spread

    // MUCH WIDER rays for visibility
    float rayWidths[7];
    rayWidths[0] = 0.055;   // ~2x wider
    rayWidths[1] = 0.045;
    rayWidths[2] = 0.065;
    rayWidths[3] = 0.080;   // Center ray very wide
    rayWidths[4] = 0.050;
    rayWidths[5] = 0.060;
    rayWidths[6] = 0.048;

    // Subtle ray intensities for natural atmospheric effect
    float rayIntensities[7];
    rayIntensities[0] = 0.15;
    rayIntensities[1] = 0.2;
    rayIntensities[2] = 0.28;
    rayIntensities[3] = 0.35;  // Center ray brightest but subtle
    rayIntensities[4] = 0.25;
    rayIntensities[5] = 0.18;
    rayIntensities[6] = 0.12;

    for (int i = 0; i < 7; i++) {
        float angle = rayAngles[i];
        float width = rayWidths[i];
        float intensity = rayIntensities[i];

        // Add subtle time-based sway
        float sway = sin(uTime * 0.12 + float(i) * 1.8) * 0.025;
        angle += sway;

        // Create the beam with softer edges for more glow
        float beam = rayBeam(uv, angle, width, 0.2);  // Softer edges (was 0.3)

        // Add intensity variation along the ray (dust particles catching light)
        float dustNoise = snoise(vec3(uv * 6.0, uTime * 0.04 + float(i)));
        dustNoise = 0.75 + dustNoise * 0.25;

        // Irregular flicker for branch-gap style interruption
        float flicker = 0.82
            + sin(uTime * (0.21 + float(i) * 0.03) + float(i) * 1.7) * 0.1
            + sin(uTime * (0.37 + float(i) * 0.02) + float(i) * 2.3) * 0.08;
        flicker = clamp(flicker, 0.55, 1.15);

        rays += beam * intensity * dustNoise * flicker;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ATMOSPHERIC SCATTERING
    // ═══════════════════════════════════════════════════════════════════════

    // Subtle glow emanating from sun
    float sunGlow = 1.0 - smoothstep(0.0, 0.35, distToSun);
    sunGlow = pow(sunGlow, 2.5) * 0.2;  // Very subtle glow

    // Vertical gradient - subtle fade at very bottom/top only
    float verticalFade = 1.0; // Keep it uniform for now to ensure visibility

    // ═══════════════════════════════════════════════════════════════════════
    // VOLUMETRIC NOISE (dust in the air catching light)
    // ═══════════════════════════════════════════════════════════════════════

    // Large-scale atmospheric variation
    float atmosphere = snoise(vec3(uv * 3.0, uTime * 0.03));
    atmosphere = 0.85 + atmosphere * 0.15;

    // Fine dust particles
    float dust = snoise(vec3(uv * 15.0 + uTime * 0.02, uTime * 0.08));
    dust = 0.92 + dust * 0.08;

    // ═══════════════════════════════════════════════════════════════════════
    // FINAL COMPOSITION
    // ═══════════════════════════════════════════════════════════════════════

    // Combine rays with atmospheric effects
    float totalLight = rays * verticalFade * atmosphere * dust;
    totalLight += sunGlow * atmosphere;

    // Subtle pulsing
    float pulse = 0.97 + 0.03 * sin(uTime * 0.25);
    totalLight *= pulse;

    // Color gradient - warmer near sun, slightly cooler at edges
    vec3 warmColor = uRayColor;
    vec3 hotColor = vec3(1.0, 0.95, 0.85);
    vec3 color = mix(warmColor, hotColor, sunGlow + rays * 0.4);

    // Apply final opacity
    float alpha = totalLight * uOpacity;

    // Allow brighter peaks
    alpha = min(alpha, 0.95);

    gl_FragColor = vec4(color, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// FIREFLY SHADER
// ─────────────────────────────────────────────────────────────────────────────
export const fireflyVertexShader = `
uniform float uTime;
uniform float uSize;
uniform float uBoost;  // Boost from piece lock effect

attribute float aRandom;
attribute float aPhase;
attribute vec3 aVelocity;

varying float vAlpha;
varying vec3 vColor;
varying float vBoost;

void main() {
    vec3 pos = position;
    
    float t = uTime * 0.3;
    pos.x += sin(t + aPhase * 10.0) * aVelocity.x * 2.0;
    pos.y += cos(t * 0.7 + aPhase * 8.0) * aVelocity.y * 1.5;
    pos.z += sin(t * 0.5 + aPhase * 6.0) * aVelocity.z * 1.0;
    
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    
    // Size increases with boost
    float boostedSize = uSize * (1.0 + uBoost * 1.5);
    gl_PointSize = boostedSize * (180.0 / -mvPosition.z);
    gl_PointSize = clamp(gl_PointSize, 2.0, 30.0);
    
    // Each firefly has unique twinkle timing based on phase + boost
    float twinkleSpeed = 6.28 + uBoost * 12.0;  // Faster twinkle when boosted
    float pulse = sin(uTime * twinkleSpeed + aPhase * 15.0) * 0.5 + 0.5;
    
    // Sharp twinkle effect when boosted
    float twinklePow = mix(2.0, 0.5, uBoost);  // Sharper peaks when boosted
    pulse = pow(pulse, twinklePow);
    
    // Alpha boosted strongly
    vAlpha = 0.3 + pulse * 0.7 + uBoost * 0.5;
    
    // Warm amber/orange fireflies for sunset - brighter when boosted
    float hueShift = aRandom * 0.15;
    vColor = vec3(1.0, 0.7 + hueShift, 0.25 + hueShift * 0.3);
    
    vBoost = uBoost;
}
`;

export const fireflyFragmentShader = `
varying float vAlpha;
varying vec3 vColor;
varying float vBoost;

void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);
    if (dist > 0.5) discard;
    
    float glow = 1.0 - smoothstep(0.0, 0.5, dist);
    glow = pow(glow, 1.5);
    
    // Brighter, larger core when boosted
    float coreSize = 0.15 + vBoost * 0.1;
    float core = 1.0 - smoothstep(0.0, coreSize, dist);
    
    // Color intensity increases with boost
    vec3 boostedColor = vColor * (1.0 + vBoost * 0.8);
    vec3 color = boostedColor * (glow + core * (0.5 + vBoost * 1.0));
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
    // Reduced visibility for sunset sky - stars barely visible
    float alpha = (core + glow * 0.3) * vAlpha * 0.25;

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

// ─────────────────────────────────────────────────────────────────────────────
// INSTANCED TREE FOLIAGE SHADER - For InstancedMesh optimization
// Uses per-instance attributes for color and sway variation
// ─────────────────────────────────────────────────────────────────────────────
export const instancedFoliageVertexShader = `
uniform float uTime;
uniform float uGlowIntensity;

// Per-instance attributes
attribute vec3 aInstanceColor;    // Tree layer color (darker front, lighter back)
attribute float aInstanceSway;    // Sway amount based on layer depth
attribute float aInstancePhase;   // Random phase offset for wind variation

varying vec2 vUv;
varying float vHeight;
varying vec3 vInstanceColor;
varying float vGlowIntensity;

void main() {
    vUv = uv;
    vHeight = position.y;
    vInstanceColor = aInstanceColor;
    vGlowIntensity = uGlowIntensity;
    
    // Apply instance transform first
    vec4 instancePosition = instanceMatrix * vec4(position, 1.0);
    
    // Gentle wind sway based on height and instance-specific parameters
    float heightFactor = smoothstep(0.0, 1.0, (position.y + 1.0) * 0.5);
    float sway = sin(uTime * 0.5 + instancePosition.x * 0.1 + aInstancePhase) * aInstanceSway * heightFactor;
    
    instancePosition.x += sway;
    
    gl_Position = projectionMatrix * modelViewMatrix * instancePosition;
}
`;

export const instancedFoliageFragmentShader = `
varying vec2 vUv;
varying float vHeight;
varying vec3 vInstanceColor;
varying float vGlowIntensity;

void main() {
    vec3 color = vInstanceColor;
    
    // Edge highlight for depth
    float edge = smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
    vec3 highlight = color * 1.15;
    color = mix(color, highlight, (1.0 - edge) * 0.3);
    
    // Warm glow during events (sunset amber)
    vec3 glowColor = vec3(1.0, 0.7, 0.3);
    color += glowColor * vGlowIntensity * 0.25;
    
    gl_FragColor = vec4(color, 1.0);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// INSTANCED TRUNK SHADER - For InstancedMesh optimization
// ─────────────────────────────────────────────────────────────────────────────
export const instancedTrunkVertexShader = `
attribute vec3 aInstanceColor;  // Trunk color per instance

varying vec2 vUv;
varying vec3 vInstanceColor;

void main() {
    vUv = uv;
    vInstanceColor = aInstanceColor;
    
    vec4 instancePosition = instanceMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * instancePosition;
}
`;

export const instancedTrunkFragmentShader = `
uniform float uGlowIntensity;

varying vec2 vUv;
varying vec3 vInstanceColor;

void main() {
    vec3 color = vInstanceColor;
    color *= 0.9 + vUv.y * 0.1;

    // Rune glow during events - warm orange instead of cyan
    float runeGlow = smoothstep(0.3, 0.5, vUv.y) * smoothstep(0.7, 0.5, vUv.y);
    runeGlow *= smoothstep(0.3, 0.5, vUv.x) * smoothstep(0.7, 0.5, vUv.x);
    color += vec3(1.0, 0.6, 0.3) * runeGlow * uGlowIntensity * 0.4;

    gl_FragColor = vec4(color, 1.0);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// SUN SHADER - Large glowing sun for Firewatch-style sunset
// ─────────────────────────────────────────────────────────────────────────────
export const sunVertexShader = `
varying vec2 vUv;
varying vec3 vNormal;

void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const sunFragmentShader = `
uniform float uTime;
uniform float uIntensity;
uniform vec3 uCoreColor;
uniform vec3 uCoronaColor;
uniform vec3 uEdgeColor;
uniform vec3 uHaloColor;
uniform float uHaloIntensity;

varying vec2 vUv;
varying vec3 vNormal;

${noiseCommon}

void main() {
    vec2 center = vUv - 0.5;
    float dist = length(center);

    // Animated turbulence for living sun effect
    float turb = snoise(vec3(vUv * 5.5, uTime * 0.25)) * 0.06;
    turb += snoise(vec3(vUv * 11.5 + 9.0, -uTime * 0.18)) * 0.03;

    // Layered radial components
    float core = 1.0 - smoothstep(0.0, 0.18 + turb * 0.35, dist);
    float corona = 1.0 - smoothstep(0.08, 0.42 + turb * 0.65, dist);
    float halo = 1.0 - smoothstep(0.22, 0.72 + turb * 0.45, dist);

    // Fresnel-like term for edge richness
    float fresnel = pow(1.0 - clamp(abs(vNormal.z), 0.0, 1.0), 1.5);
    float blend = clamp(pow(dist * 1.8, 1.2) + fresnel * 0.25, 0.0, 1.0);
    vec3 sunSurface = mix(uCoreColor, uCoronaColor, blend);

    vec3 color = sunSurface * (core * 1.85 + corona * 0.95);
    color += uHaloColor * halo * (0.45 + fresnel * 0.65) * uHaloIntensity;

    // Warm edge ring for separation from halo
    float edgeRing = smoothstep(0.22, 0.52, dist) * (1.0 - smoothstep(0.52, 0.82, dist));
    color += uEdgeColor * edgeRing * 0.55;

    // Gentle breathing pulse (Phase 2 target)
    float pulse = 1.0 + sin(uTime * 0.8) * 0.05;
    color *= pulse * uIntensity;

    float alpha = smoothstep(0.86, 0.1, dist);
    alpha = max(alpha, halo * 0.28 * uHaloIntensity);
    alpha = clamp(alpha, 0.0, 1.0);

    gl_FragColor = vec4(color, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// DUST MOTES SHADER - Floating particles in sunlight
// ─────────────────────────────────────────────────────────────────────────────
export const dustVertexShader = `
uniform float uTime;
uniform float uSize;

attribute float aPhase;
attribute float aRandom;

varying float vAlpha;
varying vec3 vColor;

void main() {
    vec3 pos = position;

    // Gentle floating motion
    float t = uTime * 0.2;
    pos.x += sin(t + aPhase * 10.0) * 2.0;
    pos.y += cos(t * 0.7 + aPhase * 8.0) * 1.5 + sin(t * 0.3) * 0.5;
    pos.z += sin(t * 0.5 + aPhase * 6.0) * 1.0;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    gl_PointSize = uSize * (150.0 / -mvPosition.z);
    gl_PointSize = clamp(gl_PointSize, 1.0, 8.0);

    // Twinkling effect
    float twinkle = sin(uTime * 4.0 + aPhase * 20.0) * 0.3 + 0.7;
    vAlpha = twinkle * (0.3 + aRandom * 0.4);

    // Warm golden color with slight variation
    vColor = vec3(1.0, 0.85 + aRandom * 0.1, 0.5 + aRandom * 0.2);
}
`;

export const dustFragmentShader = `
varying float vAlpha;
varying vec3 vColor;

void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);

    if (dist > 0.5) discard;

    float glow = 1.0 - smoothstep(0.0, 0.5, dist);
    glow = pow(glow, 2.0);

    gl_FragColor = vec4(vColor, glow * vAlpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// MOUNTAIN SHADER - Firewatch-style layered silhouettes with atmospheric depth
// ─────────────────────────────────────────────────────────────────────────────
export const mountainVertexShader = `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const mountainFragmentShader = `
uniform vec3 uShadowColor;
uniform vec3 uMidColor;
uniform vec3 uHighlightColor;
uniform vec3 uRimColor;
uniform vec3 uMistColor;
uniform vec3 uFogColor;
uniform vec3 uLightDirection;
uniform float uFogAmount;
uniform float uLayer;
uniform float uTime;
uniform float uMistStrength;

varying vec2 vUv;

${noiseCommon}

float sampleMountainHeight(vec2 uv, float layer, float time) {
    // Mountain shape using layered noise - Firewatch style jagged peaks
    float height = 0.0;
    float offset = layer * 87.654;

    height += snoise(vec3(uv.x * 0.8 + offset, 0.0, 0.0)) * 0.35;
    height += snoise(vec3(uv.x * 1.8 + offset, 0.5, 0.0)) * 0.25;
    height += snoise(vec3(uv.x * 4.0 + offset, 1.0, 0.0)) * 0.15;
    height += snoise(vec3(uv.x * 8.0 + offset, 1.5, 0.0)) * 0.08;

    height = height * 0.5 + 0.5;
    height *= (0.55 + layer * 0.25);

    float shimmer = sin(time * 0.4 + uv.x * 8.0) * 0.008 * (1.0 - layer * 0.5);
    height += shimmer;

    return height;
}

void main() {
    vec2 uv = vUv;
    float mountainHeight = sampleMountainHeight(uv, uLayer, uTime);

    // Outside silhouette → discard
    if (uv.y > mountainHeight) discard;

    float depthFromPeak = clamp((mountainHeight - uv.y) / max(mountainHeight, 0.0001), 0.0, 1.0);
    float peakFactor = 1.0 - depthFromPeak;

    // Approximate normals from the height map to drive lighting
    const float EPS = 0.002;
    float heightX = sampleMountainHeight(vec2(uv.x + EPS, uv.y), uLayer, uTime);
    float heightY = sampleMountainHeight(vec2(uv.x, uv.y + EPS), uLayer, uTime);
    float slopeScale = 45.0;
    vec3 dx = vec3(EPS, (heightX - mountainHeight) * slopeScale, 0.0);
    vec3 dy = vec3(0.0, (heightY - mountainHeight) * slopeScale, EPS);
    vec3 normal = normalize(cross(dy, dx));

    vec3 lightDir = normalize(uLightDirection);
    float diffuse = clamp(dot(normal, lightDir), 0.0, 1.0);

    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    float rim = pow(1.0 - clamp(dot(normal, viewDir), 0.0, 1.0), 1.8);
    rim *= smoothstep(0.25, 0.95, peakFactor);

    // Base gradient: darker base, lighter peaks
    float shadedMix = mix(0.35, 0.9, peakFactor);
    vec3 color = mix(uShadowColor, uMidColor, shadedMix);
    color = mix(color, uHighlightColor, diffuse * (0.4 + peakFactor * 0.5));

    // Crevice darkening for downward slopes
    float creviceShadow = smoothstep(0.0, 0.7, depthFromPeak) * (1.0 - diffuse) * 0.35;
    color = mix(color, uShadowColor, creviceShadow);

    // Subtle noise detail so silhouettes feel organic
    float detail = snoise(vec3(uv.x * 8.0 + uLayer * 4.0, uv.y * 10.0, uTime * 0.05));
    color += detail * 0.04 * (0.6 + peakFactor * 0.4);

    // Warm mist hugging the base
    float baseMist = smoothstep(0.2, 1.0, depthFromPeak);
    color = mix(color, uMistColor, baseMist * uMistStrength);

    // Rim highlight where the sun silhouettes the edge
    color = mix(color, uRimColor, rim * 0.6);

    float fogMix = clamp(uFogAmount * (0.6 + depthFromPeak * 0.4), 0.0, 1.0);
    vec3 foggedColor = mix(color, uFogColor, fogMix);

    gl_FragColor = vec4(foggedColor, 1.0);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// HAZE LAYER SHADER - Atmospheric haze between tree layers
// ─────────────────────────────────────────────────────────────────────────────
export const hazeVertexShader = `
varying vec2 vUv;
varying float vFogDepth;

void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vFogDepth = -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
}
`;

export const hazeFragmentShader = `
uniform float uTime;
uniform vec3 uHazeColor;
uniform float uDensity;
uniform float uLayerDepth;
uniform vec2 uDrift;

varying vec2 vUv;
varying float vFogDepth;

${noiseCommon}

void main() {
    vec2 uv = vUv;

    // Animated multi-band noise for organic haze movement
    vec2 flow = uv + uDrift * uTime * 0.03;
    float noise1 = snoise(vec3(flow.x * 2.0, flow.y * 1.45, uTime * 0.02)) * 0.5 + 0.5;
    float noise2 = snoise(vec3(flow.x * 4.0 - uTime * 0.03, flow.y * 2.7, uTime * 0.015)) * 0.5 + 0.5;

    float haze = noise1 * 0.7 + noise2 * 0.3;

    // Vertical falloff - more haze at bottom
    float verticalFade = 1.0 - smoothstep(0.0, 0.7, uv.y);

    // Horizontal variation
    float horizontalVar = 0.85 + sin(uv.x * 3.14159) * 0.15;

    // Deeper layers appear softer/fainter
    float layerSoftness = mix(1.05, 0.7, clamp(uLayerDepth, 0.0, 1.0));
    float alpha = haze * verticalFade * horizontalVar * uDensity * layerSoftness;
    float depthFade = smoothstep(18.0, 160.0, vFogDepth);
    alpha *= mix(1.0, 0.72, depthFade);

    // Warmer color toward bottom
    vec3 warmBoost = vec3(1.06, 0.98, 0.9);
    vec3 color = mix(uHazeColor, uHazeColor * warmBoost, verticalFade * 0.35);
    color = mix(color, uHazeColor * 0.92, clamp(uLayerDepth, 0.0, 1.0) * 0.25);

    gl_FragColor = vec4(color, alpha * 0.58);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// FOREGROUND BRANCH SHADER - Procedural silhouette branches at screen edges
// ─────────────────────────────────────────────────────────────────────────────
export const branchVertexShader = `
uniform float uTime;

varying vec2 vUv;

void main() {
    vUv = uv;

    vec3 pos = position;

    // Subtle sway animation
    float sway = sin(uTime * 0.6 + position.y * 0.3) * 0.12;
    pos.x += sway * uv.y;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

export const branchFragmentShader = `
uniform vec3 uBranchColor;
uniform float uOpacity;
uniform float uSide;
uniform float uTime;

varying vec2 vUv;

${noiseCommon}

void main() {
    vec2 uv = vUv;

    // Flip UV for right side
    if (uSide > 0.0) {
        uv.x = 1.0 - uv.x;
    }

    // Create organic branch/leaf shapes using noise
    float shape = 0.0;

    // Main diagonal branch from corner
    float diagonal = uv.x * 0.8 + uv.y * 0.5;
    float mainBranch = smoothstep(0.03, 0.0, abs(diagonal - 0.4)) * smoothstep(0.0, 0.3, uv.x);

    // Secondary branches
    float b1 = smoothstep(0.02, 0.0, abs(uv.x - 0.15 - uv.y * 0.4)) * step(0.1, uv.y) * step(uv.y, 0.6);
    float b2 = smoothstep(0.02, 0.0, abs(uv.x - 0.25 - uv.y * 0.25)) * step(0.2, uv.y) * step(uv.y, 0.5);

    // Leaf clusters using noise
    float leafNoise = snoise(vec3(uv * 6.0 + uTime * 0.05, 0.0));
    float leaves = smoothstep(0.25, 0.55, leafNoise);
    // Mask leaves to branch areas
    float leafMask = smoothstep(0.6, 0.0, uv.x) * smoothstep(0.0, 0.4, uv.y) * smoothstep(0.9, 0.5, uv.y);
    leaves *= leafMask;

    shape = max(max(mainBranch, b1), max(b2, leaves * 0.9));

    if (shape < 0.05) discard;

    gl_FragColor = vec4(uBranchColor, shape * uOpacity);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// LAKE WATER SHADER - Firewatch-style reflective water with horizontal ripples
// ─────────────────────────────────────────────────────────────────────────────
export const lakeVertexShader = `
uniform float uTime;

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

export const lakeFragmentShader = `
uniform float uTime;
uniform vec3 uWaterColorDeep;      // Deep water color (darker, near camera)
uniform vec3 uWaterColorShallow;   // Shallow/sunset reflection color (golden/orange)
uniform vec3 uSkyReflection;       // Sky color for reflection
uniform vec3 uTreeReflectionColor; // Dark tree silhouette color
uniform float uRippleIntensity;

varying vec2 vUv;
varying vec3 vWorldPos;
varying float vDepth;

${noiseCommon}

void main() {
    vec2 uv = vUv;
    
    // ═══════════════════════════════════════════════════════════════
    // 1. HORIZONTAL RIPPLE ANIMATION (Firewatch style)
    // ═══════════════════════════════════════════════════════════════
    
    // Multiple wave layers for organic movement
    float wave1 = sin(uv.y * 60.0 + uTime * 1.2) * 0.003;
    float wave2 = sin(uv.y * 35.0 - uTime * 0.8 + uv.x * 5.0) * 0.005;
    float wave3 = sin(uv.y * 90.0 + uTime * 2.0) * 0.002;
    
    // Subtle noise-based distortion
    float noiseWarp = snoise(vec3(uv.x * 3.0, uv.y * 8.0, uTime * 0.15)) * 0.008;
    
    vec2 distortedUV = uv;
    distortedUV.x += (wave1 + wave2 + wave3 + noiseWarp) * uRippleIntensity;
    
    // ═══════════════════════════════════════════════════════════════
    // 2. DEPTH-BASED COLOR GRADIENT
    // ═══════════════════════════════════════════════════════════════
    
    // Distance from shore (uv.x = 0 is shore, uv.x = 1 is deep water)
    float depthGradient = smoothstep(0.0, 0.6, uv.x);
    
    // Also consider view depth for atmospheric perspective
    float viewDepthFactor = smoothstep(20.0, 80.0, vDepth);
    
    // ═══════════════════════════════════════════════════════════════
    // 3. SUNSET SKY REFLECTION
    // ═══════════════════════════════════════════════════════════════
    
    // Reflection is strongest in distance, looking toward horizon
    float reflectionStrength = (1.0 - depthGradient) * 0.7 + 0.3;
    
    // Vertical gradient in reflection (sun higher = warmer at top of water)
    float verticalReflect = 1.0 - uv.y;
    
    // Animated sun reflection shimmer
    float sunReflect = snoise(vec3(distortedUV.x * 2.0, distortedUV.y * 15.0 - uTime * 0.5, uTime * 0.1));
    sunReflect = smoothstep(0.2, 0.8, sunReflect * 0.5 + 0.5);
    
    // ═══════════════════════════════════════════════════════════════
    // 4. TREE SILHOUETTE REFLECTIONS (Firewatch style)
    // ═══════════════════════════════════════════════════════════════
    
    // Create procedural tree reflection pattern
    // Trees are reflected from the far shore (high Y in UV)
    float treeReflectY = 1.0 - uv.y; // Flip for reflection
    
    // Procedural tree shapes using layered noise
    float treeNoise = snoise(vec3(distortedUV.x * 0.8, treeReflectY * 2.0, 0.0));
    float treeNoise2 = snoise(vec3(distortedUV.x * 2.0 + 10.0, treeReflectY * 4.0, 0.0));
    float treeNoise3 = snoise(vec3(distortedUV.x * 4.0 + 20.0, treeReflectY * 3.0, 0.0));
    
    // Combine for tree silhouette (triangular spruce shapes)
    float treeShape = treeNoise * 0.5 + treeNoise2 * 0.3 + treeNoise3 * 0.2;
    
    // Trees only appear in upper portion of water (reflection from distant shore)
    float treeMask = smoothstep(0.35, 0.65, uv.y); // Trees in middle-far distance
    treeMask *= smoothstep(0.0, 0.3, uv.x); // Fade near shore edge
    
    // Threshold for tree shape
    float treeReflection = smoothstep(0.15, 0.45, treeShape) * treeMask;
    
    // Ripple-distorted tree edges
    float rippleBreak = sin(uv.y * 80.0 + uTime * 1.5) * 0.5 + 0.5;
    treeReflection *= 0.6 + rippleBreak * 0.4;
    
    // ═══════════════════════════════════════════════════════════════
    // 5. HORIZONTAL LIGHT BANDS (Water ripple highlights)
    // ═══════════════════════════════════════════════════════════════
    
    float lightBand1 = sin(uv.y * 100.0 + uTime * 0.8) * 0.5 + 0.5;
    float lightBand2 = sin(uv.y * 70.0 - uTime * 0.5 + 1.5) * 0.5 + 0.5;
    float lightBands = lightBand1 * 0.6 + lightBand2 * 0.4;
    lightBands = smoothstep(0.5, 0.9, lightBands) * 0.15;
    
    // ═══════════════════════════════════════════════════════════════
    // 6. FINAL COLOR COMPOSITION
    // ═══════════════════════════════════════════════════════════════
    
    // Base water color (deep to shallow/reflective)
    vec3 waterBase = mix(uWaterColorShallow, uWaterColorDeep, depthGradient * 0.5);
    
    // Add sky/sun reflection
    vec3 reflectedSky = mix(uSkyReflection, uWaterColorShallow, sunReflect * 0.3);
    waterBase = mix(waterBase, reflectedSky, reflectionStrength * verticalReflect);
    
    // Add shimmer highlights
    waterBase += vec3(1.0, 0.9, 0.7) * lightBands * reflectionStrength;
    
    // Mix in tree reflections as dark silhouettes
    vec3 finalColor = mix(waterBase, uTreeReflectionColor, treeReflection * 0.7);
    
    // Atmospheric fog toward distance
    float fogFactor = smoothstep(30.0, 100.0, vDepth);
    vec3 fogColor = uSkyReflection * 0.9;
    finalColor = mix(finalColor, fogColor, fogFactor * 0.4);
    
    // Shore edge fade (soft, irregular transition to ground)
    float shoreEdgeMask = 1.0 - smoothstep(0.0, 0.25, uv.x);
    float shoreNoiseLarge = snoise(vec3(vWorldPos.x * 0.03, vWorldPos.z * 0.05, 0.0));
    float shoreNoiseDetail = snoise(vec3(vWorldPos.x * 0.09 + 12.0, vWorldPos.z * 0.12 - 6.0, 0.0));
    float shoreNoise = (shoreNoiseLarge * 0.7 + shoreNoiseDetail * 0.3) * 0.06;
    float sidePinch = smoothstep(0.2, 0.95, abs(uv.y - 0.5) * 2.0) * 0.05;
    float shoreDist = uv.x + (shoreNoise + sidePinch) * shoreEdgeMask;
    float shoreAlpha = smoothstep(0.02, 0.12, shoreDist);
    
    gl_FragColor = vec4(finalColor, shoreAlpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// LENS FLARE SHADER - Camera lens flare elements from sun
// ─────────────────────────────────────────────────────────────────────────────
export const lensFlareVertexShader = `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const lensFlareFragmentShader = `
uniform float uTime;
uniform float uOpacity;
uniform vec3 uFlareColor;
uniform float uFlareType;  // 0=circle, 1=ring, 2=hexagon, 3=streak

varying vec2 vUv;

void main() {
    vec2 center = vUv - 0.5;
    float dist = length(center);
    float angle = atan(center.y, center.x);
    
    float alpha = 0.0;
    vec3 color = uFlareColor;
    
    if (uFlareType < 0.5) {
        // Circle/orb flare
        float glow = 1.0 - smoothstep(0.0, 0.5, dist);
        glow = pow(glow, 2.0);
        alpha = glow;
        
        // Bright core
        float core = 1.0 - smoothstep(0.0, 0.15, dist);
        color = mix(color, vec3(1.0), core * 0.5);
        
    } else if (uFlareType < 1.5) {
        // Ring flare
        float ring = 1.0 - abs(dist - 0.35) * 5.0;
        ring = max(0.0, ring);
        ring = pow(ring, 1.5);
        alpha = ring;
        
    } else if (uFlareType < 2.5) {
        // Hexagon flare
        float hex = cos(angle * 3.0) * 0.1;
        float hexDist = dist + hex;
        float glow = 1.0 - smoothstep(0.2, 0.45, hexDist);
        glow *= 1.0 - smoothstep(0.0, 0.2, hexDist);
        alpha = glow * 0.8;
        
    } else {
        // Streak/anamorphic flare
        float streak = 1.0 - smoothstep(0.0, 0.5, abs(center.y) * 3.0);
        streak *= 1.0 - smoothstep(0.0, 0.5, abs(center.x));
        streak = pow(streak, 1.2);
        alpha = streak;
    }
    
    // Subtle pulse animation
    float pulse = 0.9 + sin(uTime * 1.5) * 0.1;
    alpha *= pulse * uOpacity;
    
    gl_FragColor = vec4(color, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// SKY DOME SHADER - Procedural sunset gradient with sun disc + halo
// ─────────────────────────────────────────────────────────────────────────────
export const skyDomeVertexShader = `
varying vec3 vWorldDir;

void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldDir = normalize(worldPosition.xyz - cameraPosition);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

export const skyDomeFragmentShader = `
uniform vec3 uTopColor;
uniform vec3 uUpperColor;
uniform vec3 uMidColor;
uniform vec3 uLowerColor;
uniform vec3 uHorizonColor;
uniform vec3 uSunColor;
uniform vec3 uHaloColor;
uniform vec3 uHorizonHaloColor;
uniform vec3 uSunDirection;
uniform float uSunDiscRadius;
uniform float uSunHaloRadius;
uniform float uSunDiscIntensity;
uniform float uSunHaloIntensity;
uniform float uHorizonHaloIntensity;
uniform float uHorizonHaloFalloff;
uniform float uWispScale;
uniform float uWispIntensity;
uniform float uTime;

varying vec3 vWorldDir;

${noiseCommon}

void main() {
    vec3 dir = normalize(vWorldDir);
    float elevationT = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);

    // Multi-stop sky gradient (Phase 2 target: 4+ stops)
    vec3 sky = mix(uHorizonColor, uLowerColor, smoothstep(0.0, 0.22, elevationT));
    sky = mix(sky, uMidColor, smoothstep(0.16, 0.48, elevationT));
    sky = mix(sky, uUpperColor, smoothstep(0.44, 0.75, elevationT));
    sky = mix(sky, uTopColor, smoothstep(0.72, 1.0, elevationT));

    float sunDot = max(dot(dir, normalize(uSunDirection)), 0.0);
    float sunDisk = 1.0 - smoothstep(0.0, uSunDiscRadius, 1.0 - sunDot);
    float sunHalo = 1.0 - smoothstep(0.0, uSunHaloRadius, 1.0 - sunDot);

    // Horizon halo is independent of sun direction (Phase 2 target)
    float horizonBand = 1.0 - clamp(abs(dir.y), 0.0, 1.0);
    float horizonHalo = pow(horizonBand, uHorizonHaloFalloff);

    // Subtle wispy cloud noise to break pure gradient
    float azimuth = atan(dir.z, dir.x) / 6.28318530718 + 0.5;
    vec2 wispUv = vec2(azimuth, elevationT);
    vec2 flowUv = wispUv * vec2(uWispScale, uWispScale * 0.65)
        + vec2(uTime * 0.0018, -uTime * 0.0006);
    float wispNoise = fbm(vec3(flowUv, uTime * 0.01));
    wispNoise = smoothstep(0.46, 0.76, wispNoise * 0.5 + 0.5);
    float wispMask = smoothstep(0.18, 0.58, elevationT) * (1.0 - smoothstep(0.7, 0.95, elevationT));

    vec3 color = sky;
    color += uSunColor * sunDisk * uSunDiscIntensity;
    color += uHaloColor * pow(sunHalo, 2.0) * uSunHaloIntensity;
    color += uHorizonHaloColor * horizonHalo * uHorizonHaloIntensity;
    color += mix(uLowerColor, uUpperColor, 0.5) * wispNoise * wispMask * uWispIntensity;

    gl_FragColor = vec4(color, 1.0);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// CLOUD CARD SHADER - Painterly Firewatch-style clouds
// ─────────────────────────────────────────────────────────────────────────────
export const cloudCardVertexShader = `
varying vec2 vUv;
varying vec3 vWorldPos;

void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const cloudCardFragmentShader = `
uniform float uTime;
uniform vec3 uCloudColor;
uniform vec3 uHighlightColor;
uniform vec3 uFogColor;
uniform float uOpacity;
uniform float uNoiseScale;
uniform float uSoftness;
uniform float uCoverage;
uniform vec2 uDrift;
uniform float uSeed;
uniform float uFogStart;
uniform float uFogEnd;

varying vec2 vUv;
varying vec3 vWorldPos;

${noiseCommon}

void main() {
    vec2 uv = vUv;
    vec2 driftUv = uv + uDrift * uTime;

    float edgeX = smoothstep(0.0, 0.12, uv.x) * smoothstep(1.0, 0.88, uv.x);
    float edgeY = smoothstep(0.0, 0.2, uv.y) * smoothstep(1.0, 0.8, uv.y);
    float edgeFade = edgeX * edgeY;

    vec2 noiseUv = (driftUv - 0.5) * vec2(2.0, 0.75);
    float baseNoise = fbm(vec3(noiseUv * uNoiseScale + uSeed, uTime * 0.02));
    baseNoise = baseNoise * 0.5 + 0.5;
    float detailNoise = fbm(vec3(noiseUv * (uNoiseScale * 1.8) + vec2(6.7, 3.1), uTime * 0.015));
    detailNoise = detailNoise * 0.5 + 0.5;
    float combined = mix(baseNoise, detailNoise, 0.35);

    float softness = 0.08 + uSoftness * 0.3;
    float coverage = smoothstep(uCoverage - softness, uCoverage + softness, combined);
    float alpha = coverage * edgeFade * uOpacity;

    vec3 color = mix(uCloudColor, uHighlightColor, combined * 0.25);
    color *= 0.95 + combined * 0.08;

    float dist = length(vWorldPos - cameraPosition);
    float fogFactor = smoothstep(uFogStart, uFogEnd, dist);
    color = mix(color, uFogColor, fogFactor);
    alpha *= (1.0 - fogFactor * 0.65);

    gl_FragColor = vec4(color * alpha, alpha);
}
`;
