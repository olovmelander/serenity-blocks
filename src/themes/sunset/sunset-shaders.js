/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ✧ SUNSET THEME SHADERS - Three.js 3D Edition ✧
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Beautiful sunset/sunrise shaders for an immersive 3D experience
 * Day-night cycle with magical golden hour colors
 */

// ─────────────────────────────────────────────────────────────────────────────
// SKY DOME SHADER - Animated day-night gradient
// ─────────────────────────────────────────────────────────────────────────────

export const skyVertexShader = `
    varying vec3 vWorldPosition;
    varying vec2 vUv;
    
    void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export const skyFragmentShader = `
    uniform float uTime;
    uniform float uDayProgress;
    uniform vec3 uSunPosition;
    
    // 8 phases for smoother transitions
    // Phase 0: Deep Night (0.0)
    // Phase 1: Late Night (0.08)
    // Phase 2: Early Dawn (0.15)
    // Phase 3: Dawn/Sunrise (0.22)
    // Phase 4: Morning (0.35)
    // Phase 5: Noon (0.5)
    // Phase 6: Afternoon (0.65)
    // Phase 7: Golden Hour (0.75)
    // Phase 8: Sunset (0.85)
    // Phase 9: Dusk (0.92)
    // Back to Deep Night (1.0)
    
    varying vec3 vWorldPosition;
    varying vec2 vUv;
    
    // Smooth hermite interpolation
    float smoothBlend(float t) {
        return t * t * (3.0 - 2.0 * t);
    }
    
    // Get phase weight - smooth bell curve around a center point
    float getPhaseWeight(float progress, float center, float width) {
        float dist = abs(progress - center);
        // Handle wrap-around for night
        float wrapDist = min(dist, 1.0 - dist);
        return 1.0 - smoothBlend(clamp(wrapDist / width, 0.0, 1.0));
    }
    
    void main() {
        vec3 normalizedPos = normalize(vWorldPosition);
        float height = normalizedPos.y * 0.5 + 0.5;
        
        // === DEFINE 6 KEY PHASES ===
        
        // Deep Night (around 0.0 / 1.0) - Deep blue/purple
        vec3 nightTop = vec3(0.02, 0.02, 0.08);
        vec3 nightMid = vec3(0.05, 0.03, 0.12);
        vec3 nightBottom = vec3(0.08, 0.04, 0.15);
        
        // Pre-Dawn (around 0.12) - Deep purple with hint of warmth
        vec3 preDawnTop = vec3(0.08, 0.04, 0.18);
        vec3 preDawnMid = vec3(0.15, 0.06, 0.22);
        vec3 preDawnBottom = vec3(0.25, 0.10, 0.25);
        
        // Dawn/Sunrise (around 0.22) - Rose and orange
        vec3 dawnTop = vec3(0.10, 0.08, 0.25);
        vec3 dawnMid = vec3(0.85, 0.45, 0.55);
        vec3 dawnBottom = vec3(1.0, 0.65, 0.35);
        
        // Morning (around 0.35) - Soft blue with golden horizon
        vec3 morningTop = vec3(0.45, 0.65, 0.95);
        vec3 morningMid = vec3(0.75, 0.80, 0.92);
        vec3 morningBottom = vec3(1.0, 0.92, 0.75);
        
        // Noon (around 0.5) - Bright blue sky
        vec3 noonTop = vec3(0.35, 0.60, 0.95);
        vec3 noonMid = vec3(0.65, 0.80, 0.98);
        vec3 noonBottom = vec3(0.85, 0.90, 0.95);
        
        // Afternoon (around 0.62) - Warm blue
        vec3 afternoonTop = vec3(0.40, 0.55, 0.88);
        vec3 afternoonMid = vec3(0.70, 0.75, 0.90);
        vec3 afternoonBottom = vec3(0.95, 0.88, 0.75);
        
        // Golden Hour (around 0.72) - Warm orange glow
        vec3 goldenTop = vec3(0.25, 0.35, 0.65);
        vec3 goldenMid = vec3(0.95, 0.65, 0.45);
        vec3 goldenBottom = vec3(1.0, 0.75, 0.35);
        
        // Sunset (around 0.82) - Deep orange and purple
        vec3 sunsetTop = vec3(0.15, 0.10, 0.35);
        vec3 sunsetMid = vec3(0.85, 0.35, 0.30);
        vec3 sunsetBottom = vec3(1.0, 0.55, 0.20);
        
        // Dusk (around 0.92) - Purple transitioning to night
        vec3 duskTop = vec3(0.08, 0.05, 0.20);
        vec3 duskMid = vec3(0.25, 0.12, 0.30);
        vec3 duskBottom = vec3(0.40, 0.18, 0.35);
        
        // === CALCULATE PHASE WEIGHTS ===
        float wNight = getPhaseWeight(uDayProgress, 0.0, 0.12);
        float wNightEnd = getPhaseWeight(uDayProgress, 1.0, 0.08); // Wrap-around
        float wPreDawn = getPhaseWeight(uDayProgress, 0.12, 0.08);
        float wDawn = getPhaseWeight(uDayProgress, 0.22, 0.08);
        float wMorning = getPhaseWeight(uDayProgress, 0.35, 0.10);
        float wNoon = getPhaseWeight(uDayProgress, 0.50, 0.10);
        float wAfternoon = getPhaseWeight(uDayProgress, 0.62, 0.08);
        float wGolden = getPhaseWeight(uDayProgress, 0.72, 0.07);
        float wSunset = getPhaseWeight(uDayProgress, 0.82, 0.07);
        float wDusk = getPhaseWeight(uDayProgress, 0.92, 0.06);
        
        // Combine night weights for wrap-around
        float totalNight = wNight + wNightEnd;
        
        // === BLEND ALL PHASES ===
        float totalWeight = totalNight + wPreDawn + wDawn + wMorning + wNoon + wAfternoon + wGolden + wSunset + wDusk;
        totalWeight = max(totalWeight, 0.001); // Avoid division by zero
        
        vec3 topColor = (
            nightTop * totalNight +
            preDawnTop * wPreDawn +
            dawnTop * wDawn +
            morningTop * wMorning +
            noonTop * wNoon +
            afternoonTop * wAfternoon +
            goldenTop * wGolden +
            sunsetTop * wSunset +
            duskTop * wDusk
        ) / totalWeight;
        
        vec3 midColor = (
            nightMid * totalNight +
            preDawnMid * wPreDawn +
            dawnMid * wDawn +
            morningMid * wMorning +
            noonMid * wNoon +
            afternoonMid * wAfternoon +
            goldenMid * wGolden +
            sunsetMid * wSunset +
            duskMid * wDusk
        ) / totalWeight;
        
        vec3 bottomColor = (
            nightBottom * totalNight +
            preDawnBottom * wPreDawn +
            dawnBottom * wDawn +
            morningBottom * wMorning +
            noonBottom * wNoon +
            afternoonBottom * wAfternoon +
            goldenBottom * wGolden +
            sunsetBottom * wSunset +
            duskBottom * wDusk
        ) / totalWeight;
        
        // Create smooth vertical gradient
        vec3 skyColor;
        float gradientT = smoothBlend(height);
        if (height > 0.5) {
            skyColor = mix(midColor, topColor, smoothBlend((height - 0.5) * 2.0));
        } else {
            skyColor = mix(bottomColor, midColor, smoothBlend(height * 2.0));
        }
        
        // Add sun glow near horizon
        vec3 sunDir = normalize(uSunPosition);
        float sunDot = max(0.0, dot(normalizedPos, sunDir));
        float sunGlow = pow(sunDot, 6.0) * 0.6;
        
        // Sun glow color varies with time
        float dayAmount = wMorning + wNoon + wAfternoon;
        float sunsetAmount = wGolden + wSunset;
        vec3 glowColor = mix(
            mix(vec3(1.0, 0.8, 0.5), vec3(1.0, 0.5, 0.2), sunsetAmount),
            vec3(1.0, 0.9, 0.7),
            dayAmount
        );
        
        // Only show sun glow when sun is up
        float sunUp = 1.0 - totalNight - wPreDawn * 0.5 - wDusk * 0.5;
        skyColor += glowColor * sunGlow * max(0.0, sunUp);
        
        gl_FragColor = vec4(skyColor, 1.0);
    }
`;


// ─────────────────────────────────────────────────────────────────────────────
// SUN SHADER - Glowing procedural sun
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
    
    varying vec2 vUv;
    varying vec3 vNormal;
    
    // Simple noise function
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
    
    void main() {
        vec2 center = vUv - 0.5;
        float dist = length(center);
        
        // Animated turbulence
        float turb = noise(vUv * 8.0 + uTime * 0.5) * 0.15;
        turb += noise(vUv * 16.0 - uTime * 0.3) * 0.08;
        
        // Core glow
        float core = 1.0 - smoothstep(0.0, 0.35 + turb, dist);
        
        // Corona
        float corona = 1.0 - smoothstep(0.1, 0.5 + turb, dist);
        
        // Edge glow
        float edge = 1.0 - smoothstep(0.3, 0.55, dist);
        
        // Combine colors
        vec3 color = uCoreColor * core * 1.5;
        color += uCoronaColor * corona * 0.8;
        color += uEdgeColor * edge * 0.4;
        
        // Pulsing intensity
        float pulse = 1.0 + sin(uTime * 2.0) * 0.1;
        color *= pulse * uIntensity;
        
        float alpha = smoothstep(0.55, 0.4, dist);
        
        gl_FragColor = vec4(color, alpha);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// STAR SHADER - Twinkling starfield
// ─────────────────────────────────────────────────────────────────────────────

export const starVertexShader = `
    uniform float uTime;
    uniform float uDayProgress;
    
    attribute float aSize;
    attribute float aPhase;
    attribute vec3 aColor;
    
    varying vec3 vColor;
    varying float vAlpha;
    
    void main() {
        vColor = aColor;
        
        // Calculate star visibility based on day progress
        // Stars visible at night (0.6 - 1.0 and 0.0 - 0.15)
        float nightVisibility = 0.0;
        if (uDayProgress > 0.65) {
            nightVisibility = smoothstep(0.65, 0.8, uDayProgress);
        } else if (uDayProgress < 0.2) {
            nightVisibility = 1.0 - smoothstep(0.1, 0.2, uDayProgress);
        }
        
        // Twinkling
        float twinkle = 0.5 + 0.5 * sin(uTime * 3.0 + aPhase * 10.0);
        vAlpha = nightVisibility * twinkle;
        
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        
        // Size with attenuation
        gl_PointSize = aSize * (300.0 / -mvPosition.z) * nightVisibility;
    }
`;

export const starFragmentShader = `
    varying vec3 vColor;
    varying float vAlpha;
    
    void main() {
        vec2 center = gl_PointCoord - 0.5;
        float dist = length(center);
        
        // Soft circular star
        float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
        alpha *= vAlpha;
        
        gl_FragColor = vec4(vColor, alpha);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// GOD RAY SHADER - Volumetric light rays
// ─────────────────────────────────────────────────────────────────────────────

export const godRayVertexShader = `
    varying vec2 vUv;
    
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export const godRayFragmentShader = `
    uniform float uTime;
    uniform float uIntensity;
    uniform vec3 uColor;
    
    varying vec2 vUv;
    
    void main() {
        // Radial from center
        vec2 center = vUv - 0.5;
        float dist = length(center);
        float angle = atan(center.y, center.x);
        
        // Create ray pattern
        float rays = sin(angle * 12.0 + uTime * 0.5) * 0.5 + 0.5;
        rays *= sin(angle * 8.0 - uTime * 0.3) * 0.5 + 0.5;
        
        // Fade with distance from center
        float fade = 1.0 - smoothstep(0.0, 0.5, dist);
        
        // Flickering
        float flicker = 0.8 + 0.2 * sin(uTime * 4.0 + angle * 3.0);
        
        float alpha = rays * fade * uIntensity * flicker;
        
        gl_FragColor = vec4(uColor, alpha * 0.4);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// PARTICLE SHADER - Floating dust motes and embers
// ─────────────────────────────────────────────────────────────────────────────

export const particleVertexShader = `
    uniform float uTime;
    
    attribute float aSize;
    attribute float aPhase;
    attribute vec3 aColor;
    
    varying vec3 vColor;
    varying float vAlpha;
    
    void main() {
        vColor = aColor;
        
        // Gentle floating motion
        vec3 pos = position;
        pos.y += sin(uTime * 0.5 + aPhase * 6.28) * 2.0;
        pos.x += cos(uTime * 0.3 + aPhase * 4.0) * 1.5;
        pos.z += sin(uTime * 0.4 + aPhase * 5.0) * 1.0;
        
        // Pulsing alpha
        vAlpha = 0.4 + 0.3 * sin(uTime * 2.0 + aPhase * 10.0);
        
        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        
        gl_PointSize = aSize * (200.0 / -mvPosition.z);
    }
`;

export const particleFragmentShader = `
    varying vec3 vColor;
    varying float vAlpha;
    
    void main() {
        vec2 center = gl_PointCoord - 0.5;
        float dist = length(center);
        
        // Soft glow
        float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
        alpha *= vAlpha;
        
        gl_FragColor = vec4(vColor, alpha);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// SHOCKWAVE SHADER - Combo effect expanding rings
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
    uniform float uOpacity;
    uniform vec3 uColor;
    
    varying vec2 vUv;
    
    void main() {
        vec2 center = vUv - 0.5;
        float dist = length(center);
        
        // Ring shape
        float ring = 1.0 - abs(dist - 0.4) * 10.0;
        ring = clamp(ring, 0.0, 1.0);
        
        // Fade at edges
        float fade = 1.0 - smoothstep(0.3, 0.5, dist);
        
        float alpha = ring * fade * uOpacity;
        
        gl_FragColor = vec4(uColor, alpha);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// SOLAR FLARE SHADER - Lock piece effect
// ─────────────────────────────────────────────────────────────────────────────

export const flareVertexShader = `
    uniform float uTime;
    
    attribute float aPhase;
    attribute vec3 aVelocity;
    
    varying float vAlpha;
    varying vec3 vColor;
    
    void main() {
        // Move particles outward
        vec3 pos = position + aVelocity * uTime;
        
        // Fade out over time
        vAlpha = 1.0 - uTime * 2.0;
        vColor = vec3(1.0, 0.6, 0.2); // Orange-gold
        
        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        
        gl_PointSize = (6.0 - uTime * 8.0) * (150.0 / -mvPosition.z);
    }
`;

export const flareFragmentShader = `
    varying float vAlpha;
    varying vec3 vColor;
    
    void main() {
        vec2 center = gl_PointCoord - 0.5;
        float dist = length(center);
        
        float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
        alpha *= max(0.0, vAlpha);
        
        gl_FragColor = vec4(vColor, alpha);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// HORIZON SHADER - Ground/landscape silhouette
// ─────────────────────────────────────────────────────────────────────────────

export const horizonVertexShader = `
    varying vec2 vUv;
    
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export const horizonFragmentShader = `
    uniform float uDayProgress;
    uniform vec3 uDayColor;
    uniform vec3 uNightColor;
    
    varying vec2 vUv;
    
    void main() {
        // Gradient from horizon up
        float gradient = 1.0 - vUv.y;
        
        // Time-based color
        float nightness = 0.0;
        if (uDayProgress > 0.65) {
            nightness = smoothstep(0.65, 0.85, uDayProgress);
        } else if (uDayProgress < 0.2) {
            nightness = 1.0 - smoothstep(0.05, 0.2, uDayProgress);
        }
        
        vec3 color = mix(uDayColor, uNightColor, nightness);
        
        float alpha = gradient * 0.8;
        
        gl_FragColor = vec4(color, alpha);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// MOON SHADER - Beautiful cratered moon for night
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
    uniform float uOpacity;
    
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vPosition;
    varying vec3 vLocalPos;
    varying vec3 vViewPosition;
    
    // Noise functions for surface detail
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
    
    // Sharp crater with bowl and rim
    float sharpCrater(vec3 pos, vec3 center, float size, float depth) {
        float d = length(pos - center);
        float bowl = smoothstep(size, size * 0.15, d);
        float rim = smoothstep(size * 1.35, size * 0.95, d) * smoothstep(size * 0.8, size * 1.0, d);
        return -bowl * depth + rim * depth * 0.6;
    }
    
    void main() {
        vec3 viewDir = normalize(vViewPosition);
        vec3 pos = normalize(vLocalPos) * 5.0;
        
        // === WARM CREAM/BEIGE MOON PALETTE ===
        vec3 brightHighland = vec3(0.95, 0.92, 0.85);   // Bright cream highlands
        vec3 darkMaria = vec3(0.55, 0.52, 0.48);        // Grey-brown maria
        vec3 craterFloor = vec3(0.35, 0.33, 0.30);      // Dark grey crater floors
        vec3 craterRim = vec3(1.0, 0.98, 0.92);         // Bright white rims
        
        // === MARIA (darker regions) ===
        float maria1 = smoothstep(0.2, 0.6, fbm(pos * 0.5 + vec3(1.5, 0.8, 0.3)));
        float maria2 = smoothstep(0.25, 0.65, fbm(pos * 0.6 + vec3(-2.0, 1.2, 0.8)));
        float totalMaria = max(maria1, maria2 * 0.9);
        
        vec3 baseColor = mix(brightHighland, darkMaria, totalMaria * 0.6);
        
        // === CRATERS ===
        float craters = 0.0;
        craters += sharpCrater(pos, vec3(2.0, 0.5, 0.8), 1.2, 0.5);
        craters += sharpCrater(pos, vec3(-1.5, 1.2, 1.0), 1.0, 0.45);
        craters += sharpCrater(pos, vec3(0.5, -1.5, 1.3), 0.9, 0.4);
        craters += sharpCrater(pos, vec3(-0.8, 0.3, -1.8), 1.1, 0.48);
        craters += sharpCrater(pos, vec3(1.5, -0.8, 1.2), 0.8, 0.38);
        craters += sharpCrater(pos, vec3(-1.8, -1.0, 0.5), 0.95, 0.42);
        craters += sharpCrater(pos, vec3(0.3, 2.0, 0.5), 0.85, 0.4);
        
        // Smaller craters via noise
        float smallCraters = fbm(pos * 3.0) * 0.15;
        craters += smallCraters;
        
        // Surface roughness
        float roughness = fbm(pos * 8.0) * 0.08 + snoise(pos * 15.0) * 0.04;
        
        // Apply crater coloring
        float floorDepth = max(0.0, -craters * 3.0);
        baseColor = mix(baseColor, craterFloor, smoothstep(0.0, 1.0, floorDepth) * 0.8);
        
        float rimBrightness = max(0.0, craters * 2.5);
        baseColor = mix(baseColor, craterRim, smoothstep(0.0, 0.6, rimBrightness) * 0.5);
        
        baseColor += vec3(roughness * 0.3);
        
        // === LIGHTING ===
        vec3 lightDir = normalize(vec3(0.5, 0.4, 0.7));
        float diffuse = max(0.0, dot(vNormal, lightDir));
        diffuse = pow(diffuse, 0.9);
        
        float lighting = 0.25 + diffuse * 0.75;
        vec3 litColor = baseColor * lighting;
        
        // Subtle rim glow
        float fresnel = pow(1.0 - abs(dot(vNormal, viewDir)), 3.0);
        litColor += vec3(0.8, 0.75, 0.65) * fresnel * 0.3;
        
        gl_FragColor = vec4(litColor, uOpacity);
    }
`;

