/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  🌲✨ STILLWATER SHADERS - A John Bauer Dreamscape ✨🌲
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * A realm between worlds - the enchanted twilight of Swedish folklore.
 * Deep forest greens, mystical teals, glowing spirits, and ancient magic.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Noise Functions
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
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
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
// Enchanted Water - Deep forest pool with spirit reflection
// ─────────────────────────────────────────────────────────────────────────────
export const waterVertexShader = `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const waterFragmentShader = `
uniform float uTime;
uniform float uSpiritGlow;
uniform vec3 uDeepColor;
uniform vec3 uSurfaceColor;
uniform vec3 uSpiritReflection;
uniform vec3 uSpiritPos;
uniform float uSpiritTransition;

varying vec2 vUv;

${noiseCommon}

void main() {
    vec2 uv = vUv;

    // Dreamy slow ripples
    float ripple = snoise(vec3(uv * 2.0, uTime * 0.08)) * 0.02;
    ripple += snoise(vec3(uv * 4.0, uTime * 0.05 + 100.0)) * 0.01;
    uv += vec2(ripple * 0.6, ripple);

    // Depth gradient - deep forest pool
    float depth = smoothstep(0.0, 0.6, uv.y);
    vec3 color = mix(uDeepColor, uSurfaceColor, depth * 0.4);

    // Dynamic spirit reflection - follows spirit position
    // Convert spirit world position to UV space (approximate)
    // Water plane is 80 wide, 35 deep, centered at z=3
    vec2 spiritUV = vec2(
        (uSpiritPos.x + 40.0) / 80.0,  // Map x from [-40, 40] to [0, 1]
        1.0 - (uSpiritPos.z + 14.5) / 35.0  // Map z from [-14.5, 20.5] to [0, 1], inverted
    );

    // Clamp to reasonable range
    spiritUV = clamp(spiritUV, vec2(0.1), vec2(0.9));

    float distToSpirit = length(uv - spiritUV);
    float spiritRefl = 1.0 - smoothstep(0.0, 0.35, distToSpirit);
    spiritRefl = pow(spiritRefl, 2.0);

    // Shimmer the reflection
    float shimmer = snoise(vec3(uv * 10.0, uTime * 0.3)) * 0.3 + 0.7;
    spiritRefl *= shimmer;

    // Apply spirit transition (fade reflection when spirit fades)
    spiritRefl *= uSpiritTransition;

    // Add spirit's warm glow to water
    float reflectionMix = clamp(spiritRefl * 0.6 * uSpiritGlow, 0.0, 1.0);
    color = mix(color, uSpiritReflection, reflectionMix);

    // Magical sparkles on surface
    float sparkle = snoise(vec3(uv * 40.0, uTime * 0.4));
    sparkle = smoothstep(0.85, 0.95, sparkle) * depth * 0.3;
    color += vec3(1.0, 0.95, 0.8) * sparkle;

    gl_FragColor = vec4(color, 0.95);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Ancient Tree Shader - Organic, living shapes
// ─────────────────────────────────────────────────────────────────────────────
export const treeVertexShader = `
uniform float uTime;

varying vec2 vUv;
varying vec3 vNormal;
varying float vFogFactor;

void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    
    // Gentle breathing motion
    vec3 pos = position;
    float breath = sin(uTime * 0.15 + position.y * 0.1) * 0.05;
    pos.x += breath * (position.y * 0.02);
    
    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    vFogFactor = smoothstep(30.0, 80.0, -mvPos.z);
    
    gl_Position = projectionMatrix * mvPos;
}
`;

export const treeFragmentShader = `
uniform vec3 uTreeColor;
uniform vec3 uFogColor;
uniform float uGlowIntensity;
uniform vec3 uGlowColor;
uniform float uDepthLayer;

varying vec2 vUv;
varying vec3 vNormal;
varying float vFogFactor;

${noiseCommon}

void main() {
    // Rich, living bark texture
    float bark = snoise(vec3(vUv * vec2(2.0, 8.0), 0.0)) * 0.1;
    vec3 color = uTreeColor + vec3(bark * 0.5, bark * 0.3, bark * 0.1);
    
    // Subtle moss patches
    float moss = snoise(vec3(vUv * 5.0, 1.0));
    if (moss > 0.3) {
        color = mix(color, vec3(0.15, 0.22, 0.12), (moss - 0.3) * 0.5);
    }
    
    // Rim lighting from spirit
    float rim = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 3.0);
    color += uGlowColor * rim * uGlowIntensity * 0.3;
    
    // Apply atmospheric fog
    color = mix(color, uFogColor, vFogFactor * uDepthLayer);
    
    gl_FragColor = vec4(color, 1.0);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Enchanted Moss - Rolling, organic, sleeping forest floor
// ─────────────────────────────────────────────────────────────────────────────
export const mossVertexShader = `
uniform float uTime;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vPosition;

void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const mossFragmentShader = `
uniform float uTime;
uniform vec3 uMossDeep;
uniform vec3 uMossMid;
uniform vec3 uMossLight;
uniform float uGlowIntensity;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vPosition;

${noiseCommon}

void main() {
    // Create organic rolling pattern
    float pattern = fbm(vec3(vUv.x * 4.0, vUv.y * 3.0, 0.0));
    float pattern2 = fbm(vec3(vUv.x * 2.0 + 10.0, vUv.y * 1.5, 0.5));
    
    // Mix moss colors organically
    vec3 color = uMossDeep;
    color = mix(color, uMossMid, smoothstep(0.3, 0.6, pattern));
    color = mix(color, uMossLight, smoothstep(0.5, 0.8, pattern2) * 0.4);
    
    // Highlight on tops
    float highlight = max(0.0, dot(vNormal, vec3(0.0, 1.0, 0.3)));
    color += vec3(0.03, 0.05, 0.02) * highlight;
    
    // Tiny white flowers/sparkles (like in the painting)
    float flowers = snoise(vec3(vUv * 60.0, 0.0));
    if (flowers > 0.88) {
        color += vec3(0.5, 0.45, 0.35) * (flowers - 0.88) * 8.0;
    }
    
    // Spirit glow influence
    color += vec3(0.05, 0.04, 0.02) * uGlowIntensity;
    
    gl_FragColor = vec4(color, 1.0);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// The Spirit (Skogsrå/Näcken) - Luminous ethereal being
// ─────────────────────────────────────────────────────────────────────────────
export const spiritVertexShader = `
uniform float uTime;

varying vec2 vUv;

void main() {
    vUv = uv;
    
    // Gentle floating
    vec3 pos = position;
    pos.y += sin(uTime * 0.4) * 0.1;
    pos.x += sin(uTime * 0.3 + 1.0) * 0.05;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

export const spiritFragmentShader = `
uniform float uTime;
uniform float uGlowIntensity;
uniform float uTransition;

varying vec2 vUv;

${noiseCommon}

void main() {
    vec2 uv = vUv;
    vec2 center = vec2(0.5, 0.35);

    // Create humanoid silhouette shape
    float body = 0.0;

    // Head (upper circle)
    vec2 headCenter = vec2(0.5, 0.72);
    float head = 1.0 - smoothstep(0.0, 0.12, length(uv - headCenter));

    // Body (oval)
    vec2 bodyCenter = vec2(0.5, 0.45);
    vec2 bodyScale = vec2(1.0, 0.6);
    float bodyDist = length((uv - bodyCenter) * bodyScale);
    float bodyShape = 1.0 - smoothstep(0.0, 0.2, bodyDist);

    // Combine shapes
    body = max(head, bodyShape);

    // Flowing hair strands
    float hair = 0.0;
    for (float i = 0.0; i < 5.0; i++) {
        float offset = (i - 2.0) * 0.08;
        vec2 hairStart = vec2(0.5 + offset, 0.65);
        float hairDistance = abs(
            uv.x - (hairStart.x + sin(uv.y * 8.0 + uTime * 0.5 + i) * 0.03)
        );
        float strand = 1.0 - smoothstep(0.0, 0.02, hairDistance);
        strand *= (1.0 - smoothstep(0.4, 0.65, uv.y)) * smoothstep(0.2, 0.35, uv.y);
        hair = max(hair, strand * 0.7);
    }

    body = max(body, hair);

    // Inner glow (brightest at center)
    float innerGlow = body * 1.5;
    innerGlow = pow(innerGlow, 1.5);

    // Outer ethereal aura
    float aura = 1.0 - smoothstep(0.0, 0.5, length(uv - center));
    aura = pow(aura, 3.0) * 0.6;

    // Shimmer effect
    float shimmer = snoise(vec3(uv * 15.0, uTime * 0.5));
    shimmer = shimmer * 0.15 + 0.85;

    // Pulsing
    float pulse = sin(uTime * 0.6) * 0.1 + 1.0;

    // Transition effect - dissolve with noise when fading
    float dissolveMask = snoise(vec3(uv * 8.0, uTime * 0.2));
    dissolveMask = dissolveMask * 0.5 + 0.5;
    float transitionMask = smoothstep(1.0 - uTransition - 0.3, 1.0 - uTransition + 0.1, dissolveMask);

    // Final glow
    float glow = (innerGlow + aura) * shimmer * pulse;
    glow *= uGlowIntensity;
    glow *= transitionMask * uTransition;  // Apply fade transition

    // Warm, ethereal color - cream/gold
    vec3 coreColor = vec3(1.0, 0.97, 0.9);
    vec3 auraColor = vec3(1.0, 0.92, 0.75);
    vec3 color = mix(auraColor, coreColor, innerGlow);

    float alpha = clamp(glow, 0.0, 1.0);

    gl_FragColor = vec4(color * glow, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Spirit Lights - Magical floating particles
// ─────────────────────────────────────────────────────────────────────────────
export const spiritLightVertexShader = `
uniform float uTime;
uniform float uSize;

attribute float aRandom;
attribute float aPhase;
attribute vec3 aColor;

varying float vAlpha;
varying vec3 vColor;

void main() {
    vec3 pos = position;
    
    // Magical floating path
    float t = uTime * 0.2;
    pos.x += sin(t + aPhase * 10.0) * 2.0 * aRandom;
    pos.y += cos(t * 0.7 + aPhase * 8.0) * 1.5 * aRandom;
    pos.z += sin(t * 0.5 + aPhase * 6.0) * 0.8;
    
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    
    gl_PointSize = uSize * (120.0 / -mvPosition.z);
    gl_PointSize = clamp(gl_PointSize, 1.5, 12.0);
    
    // Magical twinkling
    float twinkle = sin(uTime * 3.0 + aPhase * 20.0);
    twinkle = twinkle * 0.5 + 0.5;
    twinkle = pow(twinkle, 3.0);
    vAlpha = 0.2 + twinkle * 0.8;
    
    vColor = aColor;
}
`;

export const spiritLightFragmentShader = `
varying float vAlpha;
varying vec3 vColor;

void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);
    if (dist > 0.5) discard;
    
    // Soft magical glow
    float glow = 1.0 - smoothstep(0.0, 0.5, dist);
    glow = pow(glow, 2.0);
    
    // Bright core
    float core = 1.0 - smoothstep(0.0, 0.1, dist);
    
    vec3 color = vColor * (glow + core * 0.3);
    float alpha = glow * vAlpha;
    
    gl_FragColor = vec4(color, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Fog/Atmosphere - Mystical forest mist
// ─────────────────────────────────────────────────────────────────────────────
export const fogVertexShader = `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const fogFragmentShader = `
uniform float uTime;
uniform vec3 uFogColor;
uniform float uDensity;

varying vec2 vUv;

${noiseCommon}

void main() {
    // Flowing mystical mist
    float mist = fbm(vec3(vUv * 1.5, uTime * 0.02));
    float mist2 = fbm(vec3(vUv * 0.8 + 50.0, uTime * 0.015));
    
    float density = (mist * 0.5 + mist2 * 0.5) * uDensity;
    density = smoothstep(0.2, 0.7, density);
    
    // Fade at edges
    float edgeFade = smoothstep(0.0, 0.2, vUv.y) * (1.0 - smoothstep(0.8, 1.0, vUv.y));
    density *= edgeFade;
    
    gl_FragColor = vec4(uFogColor, density * 0.35);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Ripple Effect
// ─────────────────────────────────────────────────────────────────────────────
export const rippleVertexShader = `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const rippleFragmentShader = `
uniform float uOpacity;
uniform vec3 uColor;
uniform float uRadius;

varying vec2 vUv;

void main() {
    vec2 center = vec2(0.5);
    float dist = length(vUv - center) * 2.0;
    
    float ring = smoothstep(uRadius - 0.06, uRadius, dist)
        * (1.0 - smoothstep(uRadius, uRadius + 0.06, dist));
    ring *= 1.0 - smoothstep(0.6, 1.0, dist);
    
    float inner = (1.0 - smoothstep(0.0, uRadius, dist)) * 0.1;
    
    gl_FragColor = vec4(uColor, (ring + inner) * uOpacity);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Light Beam - God rays through trees
// ─────────────────────────────────────────────────────────────────────────────
export const lightBeamVertexShader = `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const lightBeamFragmentShader = `
uniform float uTime;
uniform float uOpacity;
uniform vec3 uColor;

varying vec2 vUv;

${noiseCommon}

void main() {
    float beam = 1.0 - abs(vUv.x - 0.5) * 2.0;
    beam = pow(beam, 2.5);
    
    float vertFade = 1.0 - smoothstep(0.0, 1.0, vUv.y);
    
    float noise = snoise(vec3(vUv * 2.0, uTime * 0.1));
    noise = noise * 0.2 + 0.8;
    
    float alpha = beam * vertFade * noise * uOpacity * 0.3;
    
    gl_FragColor = vec4(uColor, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Glowing Mushrooms - Bioluminescent forest floor
// ─────────────────────────────────────────────────────────────────────────────
export const mushroomVertexShader = `
uniform float uTime;

varying vec2 vUv;
varying vec3 vNormal;

void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    
    vec3 pos = position;
    float pulse = sin(uTime * 1.5) * 0.02 + 1.0;
    pos *= pulse;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

export const mushroomFragmentShader = `
uniform float uTime;
uniform vec3 uMushroomColor;
uniform vec3 uGlowColor;
uniform float uGlowIntensity;

varying vec2 vUv;
varying vec3 vNormal;

${noiseCommon}

void main() {
    vec3 color = uMushroomColor;
    
    float spots = snoise(vec3(vUv * 8.0, 0.0));
    if (spots > 0.5) {
        color = mix(color, uGlowColor, (spots - 0.5) * 0.5);
    }
    
    float edgeGlow = pow(1.0 - abs(dot(vNormal, vec3(0.0, 1.0, 0.0))), 2.0);
    float pulse = sin(uTime * 2.0) * 0.3 + 0.7;
    color += uGlowColor * edgeGlow * pulse * uGlowIntensity;
    
    float topGlow = max(0.0, dot(vNormal, vec3(0.0, 1.0, 0.0)));
    color += uGlowColor * topGlow * 0.3;
    
    gl_FragColor = vec4(color, 1.0);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Aurora Whispers - Subtle northern lights
// ─────────────────────────────────────────────────────────────────────────────
export const auroraVertexShader = `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const auroraFragmentShader = `
uniform float uTime;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform float uIntensity;

varying vec2 vUv;

${noiseCommon}

void main() {
    vec2 uv = vUv;
    
    float wave1 = sin(uv.x * 3.0 + uTime * 0.3) * 0.3;
    float wave2 = sin(uv.x * 5.0 - uTime * 0.2 + 2.0) * 0.2;
    float wave3 = sin(uv.x * 2.0 + uTime * 0.15) * 0.4;
    
    float y = uv.y + wave1 + wave2;
    
    float band1 = smoothstep(0.3, 0.5, y) * (1.0 - smoothstep(0.5, 0.7, y));
    float band2 = smoothstep(0.5, 0.65, y) * (1.0 - smoothstep(0.65, 0.85, y));
    
    float noise = snoise(vec3(uv.x * 4.0, uv.y * 2.0, uTime * 0.1));
    noise = noise * 0.5 + 0.5;
    
    float aurora = (band1 + band2 * 0.7) * noise;
    
    vec3 color = mix(uColor1, uColor2, uv.y + wave3 * 0.5);
    
    float shimmer = snoise(vec3(uv * 10.0, uTime * 0.5)) * 0.2 + 0.8;
    aurora *= shimmer;
    
    float alpha = aurora * uIntensity * 0.25;
    
    gl_FragColor = vec4(color, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Floating Spores - Dandelion seeds drifting
// ─────────────────────────────────────────────────────────────────────────────
export const sporeVertexShader = `
uniform float uTime;
uniform float uSize;

attribute float aRandom;
attribute float aPhase;

varying float vAlpha;

void main() {
    vec3 pos = position;
    
    float t = uTime * 0.15;
    pos.x += sin(t + aPhase * 8.0) * 3.0 * aRandom;
    pos.y += sin(t * 0.5 + aPhase * 5.0) * 1.0 + t * 0.5;
    pos.z += cos(t * 0.3 + aPhase * 6.0) * 1.5;
    
    pos.y = mod(pos.y, 25.0);
    
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    
    gl_PointSize = uSize * (80.0 / -mvPosition.z);
    gl_PointSize = clamp(gl_PointSize, 1.0, 6.0);
    
    float fade = sin(uTime * 0.5 + aPhase * 10.0) * 0.3 + 0.7;
    vAlpha = fade * 0.6;
}
`;

export const sporeFragmentShader = `
varying float vAlpha;

void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);
    if (dist > 0.5) discard;
    
    float fuzz = 1.0 - smoothstep(0.0, 0.5, dist);
    fuzz = pow(fuzz, 1.5);
    
    vec3 color = vec3(1.0, 0.98, 0.95) * fuzz;
    
    gl_FragColor = vec4(color, fuzz * vAlpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Water Lilies - Floating pads on water
// ─────────────────────────────────────────────────────────────────────────────
export const lilyVertexShader = `
uniform float uTime;

varying vec2 vUv;
varying vec3 vNormal;

void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    
    vec3 pos = position;
    pos.z += sin(uTime * 0.8 + position.x * 0.5) * 0.03;
    pos.z += cos(uTime * 0.5 + position.y * 0.3) * 0.02;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

export const lilyFragmentShader = `
uniform float uTime;
uniform vec3 uPadColor;
uniform vec3 uFlowerColor;
uniform float uGlowIntensity;

varying vec2 vUv;
varying vec3 vNormal;

${noiseCommon}

void main() {
    vec2 uv = vUv;
    vec2 center = vec2(0.5);
    float dist = length(uv - center);
    
    float pad = 1.0 - smoothstep(0.4, 0.45, dist);
    
    float notchAngle = atan(uv.y - 0.5, uv.x - 0.5);
    float notch = smoothstep(-0.3, 0.0, notchAngle)
        * (1.0 - smoothstep(0.0, 0.3, notchAngle));
    notch *= smoothstep(0.0, 0.3, dist);
    pad *= (1.0 - notch * 0.8);
    
    float veins = sin(notchAngle * 12.0) * 0.5 + 0.5;
    veins *= smoothstep(0.1, 0.3, dist);
    
    vec3 color = uPadColor;
    color = mix(color, uPadColor * 0.8, veins * 0.3);
    
    float flower = 1.0 - smoothstep(0.0, 0.1, dist);
    float petals = sin(notchAngle * 6.0 + uTime * 0.2) * 0.5 + 0.5;
    flower *= (0.7 + petals * 0.3);
    
    color = mix(color, uFlowerColor, flower);
    color += vec3(0.05, 0.04, 0.02) * uGlowIntensity;
    
    float light = max(0.0, dot(vNormal, vec3(0.0, 1.0, 0.0)));
    color *= (0.8 + light * 0.2);
    
    float alpha = pad;
    if (alpha < 0.1) discard;
    
    gl_FragColor = vec4(color, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Canopy Stars - Distant stars peeking through tree gaps
// ─────────────────────────────────────────────────────────────────────────────
export const starsVertexShader = `
uniform float uTime;
uniform float uSize;

attribute float aRandom;
attribute float aBrightness;

varying float vBrightness;
varying float vTwinkle;

void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    
    gl_PointSize = uSize * aBrightness * (100.0 / -mvPosition.z);
    gl_PointSize = clamp(gl_PointSize, 0.5, 4.0);
    
    float twinkle = sin(uTime * 2.0 + aRandom * 50.0);
    twinkle = twinkle * 0.4 + 0.6;
    vTwinkle = twinkle;
    vBrightness = aBrightness;
}
`;

export const starsFragmentShader = `
varying float vBrightness;
varying float vTwinkle;

void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);
    if (dist > 0.5) discard;
    
    float glow = 1.0 - smoothstep(0.0, 0.5, dist);
    glow = pow(glow, 2.0);
    
    vec3 color = vec3(1.0, 0.95, 0.85) * glow * vBrightness * vTwinkle;
    
    gl_FragColor = vec4(color, glow * vBrightness * vTwinkle);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Troll Creatures - Small shadowy figures peeking from hiding
// ─────────────────────────────────────────────────────────────────────────────
export const trollVertexShader = `
uniform float uTime;
uniform float uBreathScale;
uniform float uSquish; // New: Vertical squish/stretch factor (1.0 = normal)

varying vec2 vUv;

void main() {
    vUv = uv;
    
    vec3 pos = position;
    
    // Playful squish/stretch effect (bouncing)
    // Scale y by uSquish, and x/z by inverse sqrt to maintain volume approx
    float inverseSquish = 1.0 / sqrt(max(0.1, uSquish));
    
    // Apply squish relative to bottom (approximate)
    // Plane geometry typically centered, so we offset origin
    float yOffset = -0.5;
    
    pos.y = (pos.y - yOffset) * uSquish + yOffset;
    pos.x *= inverseSquish;
    
    // Apply breathing scale from center (existing logic)
    vec2 center = vec2(0.0, 0.0);
    pos.xy = center + (pos.xy - center) * uBreathScale;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

export const trollFragmentShader = `
uniform float uTime;
uniform float uGlowIntensity;
uniform vec3 uEyeColor;
uniform vec3 uSpiritPos;
uniform float uPeekAmount;
uniform float uBlinkState;

// New uniforms
uniform vec2 uEyeLook;    // [-1, 1] for x and y direction
uniform float uExpression; // 0=normal, 1=wide/surprised, -1=squint/suspicious

varying vec2 vUv;

${noiseCommon}

void main() {
    vec2 uv = vUv;
    
    // ─────────────────────────────────────────────────────────────────────────
    // BODY SHAPE - Shadowy rounded creature
    // ─────────────────────────────────────────────────────────────────────────
    float body = 0.0;
    
    vec2 bodyCenter = vec2(0.5, 0.4);
    float bodyDist = length((uv - bodyCenter) * vec2(1.0, 0.8));
    body = 1.0 - smoothstep(0.0, 0.3, bodyDist);
    
    // Head (circle on top)
    vec2 headCenter = vec2(0.5, 0.65);
    float head = 1.0 - smoothstep(0.0, 0.18, length(uv - headCenter));
    
    // Big Troll Nose
    vec2 noseCenter = vec2(0.62, 0.63);
    float nose = 1.0 - smoothstep(0.0, 0.07, length(uv - noseCenter));
    
    // Pointy ears
    vec2 leftEar = vec2(0.35, 0.78);
    vec2 rightEar = vec2(0.65, 0.78);
    float earL = 1.0 - smoothstep(0.0, 0.08, length(uv - leftEar));
    float earR = 1.0 - smoothstep(0.0, 0.08, length(uv - rightEar));
    
    float troll = max(max(body, head), max(max(earL, earR), nose));
    
    // Darker body color with slight variation
    vec3 trollColor = vec3(0.08, 0.06, 0.05);

    // ─────────────────────────────────────────────────────────────────────────
    // EYES - Glowing and Expressive
    // ─────────────────────────────────────────────────────────────────────────
    
    // Eye positions
    vec2 leftEyeCenter = vec2(0.35, 0.55);
    vec2 rightEyeCenter = vec2(0.65, 0.55);
    
    // Apply expression to eye shape
    float eyeSquint = max(0.0, -uExpression); // Squint if expression < 0
    float eyeWide = max(0.0, uExpression);    // Wide if expression > 0
    
    // Dynamic eye size
    float eyeSizeBase = 0.07;
    float eyeSize = eyeSizeBase * (1.0 + eyeWide * 0.4 - eyeSquint * 0.3);
    
    // Blink (squash eyes vertically)
    float blinkScale = max(0.05, 1.0 - uBlinkState);
    
    // Look direction offset (eyes move)
    vec2 lookOffset = uEyeLook * 0.04;
    
    // Calculate eye shape distance (elliptical during blink)
    float leftEyeDist = length((uv - leftEyeCenter) * vec2(1.0, 1.0/blinkScale));
    float rightEyeDist = length((uv - rightEyeCenter) * vec2(1.0, 1.0/blinkScale));
    
    // Eye whites (glow)
    float eyes = 0.0;
    eyes += 1.0 - smoothstep(eyeSize - 0.01, eyeSize + 0.01, leftEyeDist);
    eyes += 1.0 - smoothstep(eyeSize - 0.01, eyeSize + 0.01, rightEyeDist);
    
    // Pupils (darker center) - moves with look direction
    float pupilSize = eyeSize * 0.4;
    float leftPupil = 1.0 - smoothstep(pupilSize - 0.01, pupilSize, length(uv - (leftEyeCenter + lookOffset)));
    float rightPupil = 1.0 - smoothstep(pupilSize - 0.01, pupilSize, length(uv - (rightEyeCenter + lookOffset)));
    float pupilMask = (leftPupil + rightPupil) * blinkScale; // Hide pupils when blinking
    
    // Expression: Squint lids (mask top/bottom of eyes)
    if (eyeSquint > 0.01) {
        // Top lid
        float lidY = 0.59 - eyeSquint * 0.04;
        float lid = smoothstep(lidY, lidY + 0.02, uv.y);
        eyes *= (1.0 - lid);
        // Bottom lid
        float botLidY = 0.51 + eyeSquint * 0.04;
        float botLid = 1.0 - smoothstep(botLidY - 0.02, botLidY, uv.y);
        eyes *= (1.0 - botLid);
    }
    
    // Eye Glow Color
    vec3 eyeGlow = uEyeColor * 2.5; // Bright glow
    vec3 finalEyeColor = mix(eyeGlow, vec3(1.0, 1.0, 1.0), 0.2); // White core
    finalEyeColor = mix(finalEyeColor, vec3(0.02, 0.01, 0.0), pupilMask * 0.9); // Dark pupils
    
    // Combine body and eyes
    vec3 color = trollColor;
    
    // Ambient occlusion
    float ao = smoothstep(0.0, 0.15, bodyDist) * 0.3;
    color *= (1.0 - ao * (1.0 - eyes));
    
    // Add eyes
    color = mix(color, finalEyeColor, eyes);
    
    // Extra glow from eyes falling on face
    float faceGlow = (eyes * 0.5) * (sin(uTime * 5.0) * 0.1 + 0.9);
    
    float alpha = troll;
    if (alpha < 0.1) discard;
    
    gl_FragColor = vec4(color, alpha * 0.95);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Golden Fireflies - Warm magical motes clustering near spirit
// ─────────────────────────────────────────────────────────────────────────────
export const goldenMoteVertexShader = `
uniform float uTime;
uniform float uSize;

attribute float aRandom;
attribute float aPhase;

varying float vAlpha;
varying vec3 vColor;

void main() {
    vec3 pos = position;
    
    float t = uTime * 0.3;
    pos.x += sin(t + aPhase * 6.0) * 1.5 * aRandom;
    pos.y += cos(t * 0.8 + aPhase * 4.0) * 1.0 * aRandom;
    pos.y += sin(t * 0.2) * 0.5;
    pos.z += sin(t * 0.4 + aPhase * 5.0) * 0.6;
    
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    
    gl_PointSize = uSize * (100.0 / -mvPosition.z);
    gl_PointSize = clamp(gl_PointSize, 2.0, 15.0);
    
    float breathe = sin(uTime * 2.5 + aPhase * 15.0);
    breathe = breathe * 0.5 + 0.5;
    breathe = pow(breathe, 2.0);
    vAlpha = 0.3 + breathe * 0.7;
    
    vColor = vec3(1.0, 0.85 + aRandom * 0.1, 0.5 + aRandom * 0.2);
}
`;

export const goldenMoteFragmentShader = `
varying float vAlpha;
varying vec3 vColor;

void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);
    if (dist > 0.5) discard;
    
    float glow = 1.0 - smoothstep(0.0, 0.5, dist);
    glow = pow(glow, 1.5);
    
    float core = 1.0 - smoothstep(0.0, 0.15, dist);
    
    vec3 color = vColor * (glow + core * 0.5);
    float alpha = glow * vAlpha;
    
    gl_FragColor = vec4(color, alpha);
}
`;
