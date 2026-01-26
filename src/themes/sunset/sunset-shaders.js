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
        
        // ═══════════════════════════════════════════════════════════════
        // ATMOSPHERIC SCATTERING (Rayleigh + Mie approximation)
        // ═══════════════════════════════════════════════════════════════
        
        vec3 sunDir = normalize(uSunPosition);
        float sunDot = max(0.0, dot(normalizedPos, sunDir));
        float sunUp = 1.0 - totalNight - wPreDawn * 0.5 - wDusk * 0.5;
        
        // Rayleigh scattering - blue sky scatter (view-angle dependent)
        // More blue light scattered at 90° from sun
        float rayleighPhase = 0.75 * (1.0 + sunDot * sunDot);
        float rayleighScatter = (1.0 - height) * 0.3 * rayleighPhase;
        vec3 rayleighColor = vec3(0.3, 0.5, 0.9) * rayleighScatter * sunUp;
        
        // Mie scattering - atmospheric haze around sun
        // Creates the bright halo effect at lower sun angles
        float miePhaseFactor = 1.0 / (1.0 + 30.0 * pow(1.0 - sunDot, 2.0));
        float mieScatter = miePhaseFactor * 0.08;
        
        // Mie color shifts from white at noon to orange/red at sunset
        float sunsetAmount = wGolden + wSunset + wDawn * 0.5;
        float dayAmount = wMorning + wNoon + wAfternoon;
        vec3 mieColor = mix(
            vec3(1.0, 0.95, 0.85),           // Warm white during day
            vec3(1.0, 0.6, 0.25),             // Orange at sunset/sunrise
            sunsetAmount * 0.8
        );
        vec3 mieGlow = mieColor * mieScatter * sunUp;
        
        // Add atmospheric scattering to sky
        skyColor += rayleighColor * 0.15;
        skyColor += mieGlow * 0.4;
        
        // Horizon atmospheric depth - more haze at horizon
        float horizonHaze = pow(1.0 - abs(normalizedPos.y), 4.0);
        vec3 hazeColor = mix(bottomColor, vec3(0.9, 0.85, 0.8), sunUp * 0.5);
        skyColor = mix(skyColor, hazeColor, horizonHaze * 0.25 * sunUp);
        
        // Sun disc glow - tight, controlled
        float sunGlow = pow(sunDot, 16.0) * 0.12;
        vec3 glowColor = mix(vec3(1.0, 0.5, 0.2), vec3(1.0, 0.95, 0.8), dayAmount);
        skyColor += glowColor * sunGlow * sunUp;
        
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
        
        // Combine colors - reduced multipliers to prevent over-brightness
        vec3 color = uCoreColor * core * 0.9;
        color += uCoronaColor * corona * 0.5;
        color += uEdgeColor * edge * 0.25;
        
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
    attribute float aSize;
    attribute vec2 aTwinkle; // x = phase offset, y = speed multiplier
    attribute float aBrightness;
    attribute vec3 aColor; // Renamed from color to avoid conflict

    uniform float uTime;
    uniform float uPixelRatio;
    uniform float uDayProgress;
    uniform float uEventBoost; // Optional
    
    varying float vBrightness;
    varying vec3 vColor;
    
    void main() {
        vColor = aColor; // Assign from custom attribute
        
        // ─────────────────────────────────────────────────────────────────────
        // Day/Night Visibility Logic
        // ─────────────────────────────────────────────────────────────────────
        float nightVisibility = 0.0;
        // Stars visible at night (0.65 - 1.0 and 0.0 - 0.20)
        if (uDayProgress > 0.65) {
            nightVisibility = smoothstep(0.65, 0.8, uDayProgress);
        } else if (uDayProgress < 0.2) {
            nightVisibility = 1.0 - smoothstep(0.1, 0.2, uDayProgress);
        }
        
        // Twinkle animation with varied speed per star (Blood Moon style)
        float twinkle = sin(uTime * aTwinkle.y + aTwinkle.x);
        
        // Combine base brightness, twinkle, and day/night visibility
        vBrightness = aBrightness * (0.7 + twinkle * 0.3);
        vBrightness *= nightVisibility;
        vBrightness *= (1.0 + uEventBoost * 0.5);
        
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        
        // Size attenuation for depth - larger for atmospheric look
        gl_PointSize = aSize * uPixelRatio * (300.0 / -mvPosition.z);
        
        // Clamp size but keep them visible (fading done via alpha/brightness)
        gl_PointSize = clamp(gl_PointSize, 0.0, 80.0);
        
        // If it's day, kill the size to prevent rendering artifacts
        if (nightVisibility < 0.01) gl_PointSize = 0.0;
    }
`;

export const starFragmentShader = `
    varying float vBrightness;
    varying vec3 vColor;

    void main() {
        // Soft circular point with atmospheric glow (Blood Moon style)
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
        vec3 coreColor = vColor * vBrightness * 1.5 + vec3(0.05) * core;
        
        // Atmospheric alpha based on brightnes intensity
        float alpha = softCircle * (vBrightness + 0.2);
        
        gl_FragColor = vec4(coreColor, alpha);
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
    
    // Pseudo-random noise for organic variation
    float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    
    void main() {
        // ═══════════════════════════════════════════════════════════════
        // VOLUMETRIC GOD RAYS - Radial blur sampling
        // ═══════════════════════════════════════════════════════════════
        
        vec2 center = vec2(0.5, 0.5);
        vec2 delta = vUv - center;
        float dist = length(delta);
        float angle = atan(delta.y, delta.x);
        
        // Radial blur sampling toward center
        float accumLight = 0.0;
        vec2 samplePos = vUv;
        vec2 sampleDir = normalize(-delta) * 0.02;
        
        for(int i = 0; i < 8; i++) {
            float sampleDist = length(samplePos - center);
            float lightSample = 1.0 - smoothstep(0.0, 0.45, sampleDist);
            lightSample *= lightSample;
            
            // Noise-based organic rays
            float noise = hash(samplePos * 8.0 + vec2(uTime * 0.05));
            lightSample *= 0.6 + noise * 0.8;
            
            accumLight += lightSample;
            samplePos += sampleDir;
        }
        accumLight /= 8.0;
        
        // Angular ray pattern overlay
        float rays = sin(angle * 14.0 + uTime * 0.4) * 0.4 + 0.6;
        rays *= sin(angle * 9.0 - uTime * 0.25) * 0.3 + 0.7;
        
        // Combine
        float fade = 1.0 - smoothstep(0.35, 0.55, dist);
        float pulse = 0.85 + 0.15 * sin(uTime * 1.5);
        float alpha = accumLight * rays * fade * uIntensity * pulse;
        
        gl_FragColor = vec4(uColor, alpha * 0.45);
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
    uniform vec3 uSunDirection;
    uniform sampler2D uMap;  // High-res moon texture based on image generation
    
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vPosition;
    varying vec3 vLocalPos;
    varying vec3 vViewPosition;
    
    // Pseudo-random noise for shimmer only (simplified)
    float hash(vec3 p) {
        return fract(sin(dot(p, vec3(12.9898, 78.233, 54.53))) * 43758.5453);
    }
    
    float noise1D(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                       mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                       mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
    }
    
    void main() {
        vec3 viewDir = normalize(vViewPosition);
        vec3 pos = normalize(vLocalPos);
        
        // ═══════════════════════════════════════════════════════════════
        // BASE TEXTURE - PLANAR MAPPING
        // ═══════════════════════════════════════════════════════════════
        
        // The texture is a flat "orthographic" moon. We map it planarly to the sphere's front face.
        // using local position to ensure it stays fixed to the moon geometry
        vec3 localNormal = normalize(vLocalPos);
        // Sample the generated texture
        vec4 texColor = texture2D(uMap, vUv);
        
        // No masking! Let the texture's black background handle the edge.
        // With ClampToEdgeWrapping, this works perfectly.
        
        vec3 baseColor = texColor.rgb;
        
        // Color correction - Significant boost to match water reflection intensity
        baseColor = pow(baseColor, vec3(0.7)); // Stronger gamma for contrast
        baseColor *= 1.8; // High brightness
        
        // Add subtle warm sunset glow to the moon surface itself
        baseColor = mix(baseColor, vec3(1.0, 0.9, 0.98) * baseColor, 0.25);

        // ═══════════════════════════════════════════════════════════════
        // LIGHTING
        // ═══════════════════════════════════════════════════════════════
        
        vec3 lightDir = normalize(uSunDirection);
        float NdotL = max(0.0, dot(vNormal, lightDir));
        
        // Soft diffuse with high ambient to always show texture detail
        float diffuse = NdotL * 0.7;
        float ambient = 0.35;  // High ambient so texture is always visible
        
        // Terminator softening for smooth day/night transition
        float terminator = smoothstep(-0.1, 0.25, dot(vNormal, lightDir));
        
        float lighting = ambient + diffuse * terminator;
        vec3 litColor = baseColor * lighting;
        
        // ═══════════════════════════════════════════════════════════════
        // EARTHSHINE - Blue illumination on dark side shows texture
        // ═══════════════════════════════════════════════════════════════
        float darkSide = 1.0 - NdotL;
        darkSide = smoothstep(0.2, 0.8, darkSide);
        vec3 earthshineColor = vec3(0.3, 0.4, 0.6);
        litColor += baseColor * earthshineColor * darkSide * 0.15;
        
        // ═══════════════════════════════════════════════════════════════
        // FRESNEL CORONA - Soft glow at edges
        // ═══════════════════════════════════════════════════════════════
        float viewDot = abs(dot(vNormal, viewDir));
        
        float corona1 = pow(1.0 - viewDot, 4.0);
        float corona2 = pow(1.0 - viewDot, 2.5);
        float corona3 = pow(1.0 - viewDot, 1.5);
        
        vec3 coronaColor = vec3(0.9, 0.88, 0.8);
        litColor += coronaColor * corona1 * 0.25;
        litColor += coronaColor * corona2 * 0.12;
        litColor += vec3(0.75, 0.8, 0.9) * corona3 * 0.06;
        
        // ═══════════════════════════════════════════════════════════════
        // ANIMATED SHIMMER
        // ═══════════════════════════════════════════════════════════════
        float shimmerNoise = noise1D(pos * 8.0 + vec3(uTime * 0.3));
        float shimmer = shimmerNoise * 0.03;
        shimmer *= corona2;
        litColor += vec3(shimmer);
        
        gl_FragColor = vec4(litColor, uOpacity);
    }
`;
