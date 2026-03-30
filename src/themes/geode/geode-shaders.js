/**
 * Geode Theme Shaders - Three.js 3D Implementation
 *
 * Custom GLSL shaders for:
 * - Crystal with chromatic dispersion (rainbow refraction)
 * - Stars/sparkles with twinkle animation
 * - Background with warm cosmic gradients
 * - Shooting stars with trails
 * - Crystal filaments with glow
 * - Effects (nova flash, energy pulse, etc.)
 */

// ═══════════════════════════════════════════════════════════════════════════════
// CRYSTAL SHADER - Chromatic Dispersion with Internal Glow
// ═══════════════════════════════════════════════════════════════════════════════

export const crystalVertexShader = `
    varying vec3 vNormal;
    varying vec3 vWorldPosition;
    varying vec3 vViewDir;
    varying vec3 vLocalPos;
    varying float vFresnel;
    varying vec3 vReflect;
    varying vec3 vRefractR;
    varying vec3 vRefractG;
    varying vec3 vRefractB;

    // Index of refraction for RGB channels (chromatic dispersion)
    const float iorR = 2.38;
    const float iorG = 2.42;
    const float iorB = 2.46;

    void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        vLocalPos = position;

        vec3 viewDir = normalize(cameraPosition - worldPos.xyz);
        vViewDir = viewDir;

        // Fresnel calculation
        float dotNV = dot(vNormal, viewDir);
        vFresnel = pow(1.0 - abs(dotNV), 3.0);

        // Reflection
        vReflect = reflect(-viewDir, vNormal);

        // Chromatic refraction - different IOR for each channel
        float ratioR = 1.0 / iorR;
        float ratioG = 1.0 / iorG;
        float ratioB = 1.0 / iorB;

        vRefractR = refract(-viewDir, vNormal, ratioR);
        vRefractG = refract(-viewDir, vNormal, ratioG);
        vRefractB = refract(-viewDir, vNormal, ratioB);

        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export const crystalFragmentShader = `
    uniform float uTime;
    uniform float uPulseIntensity;
    uniform vec3 uCrystalColor;
    uniform vec3 uGlowColor;
    uniform samplerCube uEnvMap;
    uniform float uEnvMapIntensity;

    varying vec3 vNormal;
    varying vec3 vWorldPosition;
    varying vec3 vViewDir;
    varying vec3 vLocalPos;
    varying float vFresnel;
    varying vec3 vReflect;
    varying vec3 vRefractR;
    varying vec3 vRefractG;
    varying vec3 vRefractB;

    void main() {
        // Sample environment map with chromatic dispersion
        float envR = textureCube(uEnvMap, vRefractR).r;
        float envG = textureCube(uEnvMap, vRefractG).g;
        float envB = textureCube(uEnvMap, vRefractB).b;
        vec3 refractedColor = vec3(envR, envG, envB);

        // Reflection
        vec3 reflectedColor = textureCube(uEnvMap, vReflect).rgb;

        // Internal glow - strongest at center, fades outward
        float distFromCenter = length(vLocalPos.xz);
        float coreGlow = exp(-distFromCenter * 0.12) * 0.9;

        // Height gradient - brighter toward crystal tip
        float heightGradient = smoothstep(-1.0, 1.0, vLocalPos.y * 0.03);

        // Pulsing animation
        float pulse = 0.7 + 0.3 * sin(uTime * 1.5 + vWorldPosition.x * 0.03 + vWorldPosition.z * 0.03);
        pulse *= (1.0 + uPulseIntensity * 3.0);

        // Sub-surface scattering approximation
        float sss = pow(1.0 - abs(dot(vNormal, vViewDir)), 2.0) * 0.5;

        // Facet highlights
        vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
        float facetHighlight = pow(max(0.0, dot(vNormal, lightDir)), 4.0) * 0.6;

        // Combine all effects
        vec3 baseColor = uCrystalColor * 0.3;

        // Add internal glow
        baseColor += uGlowColor * coreGlow * pulse * 0.8;

        // Add height gradient glow
        baseColor += uGlowColor * heightGradient * 0.4;

        // Mix in refracted environment (chromatic dispersion rainbow effect)
        baseColor = mix(baseColor, refractedColor * uCrystalColor, 0.4 * uEnvMapIntensity);

        // Add reflection at edges (Fresnel)
        baseColor = mix(baseColor, reflectedColor * 1.2, vFresnel * 0.5 * uEnvMapIntensity);

        // Add SSS glow
        baseColor += uGlowColor * sss * pulse * 0.4;

        // Add facet sparkle
        baseColor += vec3(1.0, 0.95, 0.9) * facetHighlight * pulse;

        // Final brightness
        float brightness = 0.6 + coreGlow * 0.5 + heightGradient * 0.3 + vFresnel * 0.3;

        gl_FragColor = vec4(baseColor * brightness, 0.92);
    }
`;

// Simpler crystal shader (fallback without dispersion)
export const crystalSimpleFragmentShader = `
    uniform float uTime;
    uniform float uPulseIntensity;
    uniform vec3 uCrystalColor;
    uniform vec3 uGlowColor;

    varying vec3 vNormal;
    varying vec3 vWorldPosition;
    varying vec3 vViewDir;
    varying vec3 vLocalPos;
    varying float vFresnel;

    void main() {
        // Internal glow
        float distFromCenter = length(vLocalPos.xz);
        float coreGlow = exp(-distFromCenter * 0.12) * 0.9;

        // Height gradient
        float heightGradient = smoothstep(-1.0, 1.0, vLocalPos.y * 0.03);

        // Pulsing
        float pulse = 0.7 + 0.3 * sin(uTime * 1.5 + vWorldPosition.x * 0.03);
        pulse *= (1.0 + uPulseIntensity * 3.0);

        // SSS
        float sss = pow(1.0 - abs(dot(vNormal, vViewDir)), 2.0) * 0.5;

        // Facets
        vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
        float facetHighlight = pow(max(0.0, dot(vNormal, lightDir)), 4.0) * 0.6;

        vec3 color = uCrystalColor * 0.4;
        color += uGlowColor * coreGlow * pulse * 0.9;
        color += uGlowColor * heightGradient * 0.5;
        color += uGlowColor * sss * pulse * 0.4;
        color += vec3(1.0, 0.95, 0.9) * facetHighlight * pulse;
        color += uGlowColor * vFresnel * 0.4;

        gl_FragColor = vec4(color, 0.9);
    }
`;

// ═══════════════════════════════════════════════════════════════════════════════
// BACKGROUND SHADER - Cosmic Void with Warm Gradients
// ═══════════════════════════════════════════════════════════════════════════════

export const backgroundVertexShader = `
    varying vec3 vWorldPos;
    varying vec2 vUv;

    void main() {
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export const backgroundFragmentShader = `
    uniform float uTime;
    uniform float uPulseIntensity;

    varying vec3 vWorldPos;
    varying vec2 vUv;

    // Simplex noise function
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

        vec4 x = x_ *ns.x + ns.yyyy;
        vec4 y = y_ *ns.x + ns.yyyy;
        vec4 h = 1.0 - abs(x) - abs(y);

        vec4 b0 = vec4(x.xy, y.xy);
        vec4 b1 = vec4(x.zw, y.zw);

        vec4 s0 = floor(b0)*2.0 + 1.0;
        vec4 s1 = floor(b1)*2.0 + 1.0;
        vec4 sh = -step(h, vec4(0.0));

        vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
        vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;

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

    void main() {
        vec3 dir = normalize(vWorldPos);
        float y = dir.y;
        float angle = atan(dir.x, dir.z);

        // Deep cosmic void colors (warm spectrum)
        vec3 voidBlack = vec3(0.02, 0.01, 0.03);
        vec3 deepPurple = vec3(0.06, 0.02, 0.08);
        vec3 warmBrown = vec3(0.08, 0.04, 0.03);
        vec3 hotOrange = vec3(0.15, 0.06, 0.02);

        // Vertical gradient
        float gradientPos = y * 0.5 + 0.5;
        vec3 color = mix(voidBlack, deepPurple, smoothstep(0.0, 0.4, gradientPos));
        color = mix(color, warmBrown, smoothstep(0.3, 0.6, gradientPos));
        color = mix(color, hotOrange, smoothstep(0.5, 0.9, gradientPos) * 0.3);

        // Subtle noise texture
        float noise = snoise(dir * 3.0 + uTime * 0.02) * 0.5 + 0.5;
        color += vec3(0.03, 0.01, 0.02) * noise * 0.3;

        // Faint glow hotspots (simulating distant crystals)
        float spots1 = pow(max(0.0, snoise(dir * 8.0 + uTime * 0.01)), 8.0);
        float spots2 = pow(max(0.0, snoise(dir * 5.0 - uTime * 0.015)), 10.0);
        color += vec3(0.3, 0.1, 0.15) * spots1 * 0.15;
        color += vec3(0.15, 0.2, 0.3) * spots2 * 0.1;

        // Pulse glow during events
        float pulseGlow = uPulseIntensity * 0.1;
        color += vec3(0.2, 0.08, 0.05) * pulseGlow;

        // Vignette toward edges
        float vignette = smoothstep(0.0, 0.5, abs(y));
        color *= (1.0 - vignette * 0.4);

        gl_FragColor = vec4(color, 1.0);
    }
`;

// ═══════════════════════════════════════════════════════════════════════════════
// STAR/SPARKLE SHADER - Twinkling Point Sprites
// ═══════════════════════════════════════════════════════════════════════════════

export const starVertexShader = `
    attribute float aSize;
    attribute float aTwinklePhase;
    attribute float aTwinkleSpeed;
    attribute float aBrightness;
    attribute float aRippleBoost;
    attribute vec3 aColor;

    uniform float uTime;
    uniform float uPulseIntensity;
    uniform float uAmbientPulse;

    varying float vBrightness;
    varying vec3 vColor;
    varying float vSize;

    void main() {
        vColor = aColor;

        // Twinkle animation
        float phase = aTwinklePhase + uTime * aTwinkleSpeed;
        float twinkle = sin(phase) * 0.4 + 0.6;

        // Brightness calculation
        float pulseBoost = 1.0 + uPulseIntensity * 0.5;
        float baseBrightness = aBrightness * twinkle * pulseBoost * uAmbientPulse;
        vBrightness = min(baseBrightness + aRippleBoost, 1.5);

        // Size with ripple boost
        float sizeBoost = 1.0 + aRippleBoost * 0.8;
        vSize = aSize * sizeBoost;

        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = vSize * (300.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
    }
`;

export const starFragmentShader = `
    uniform float uBrightnessThreshold;
    uniform bool uEnableGlow;

    varying float vBrightness;
    varying vec3 vColor;
    varying float vSize;

    void main() {
        if (vBrightness < uBrightnessThreshold) discard;

        vec2 coord = gl_PointCoord - 0.5;
        float dist = length(coord) * 2.0;

        if (dist > 1.0) discard;

        // Soft circular falloff
        float alpha = 1.0 - smoothstep(0.0, 1.0, dist);

        // Exponential glow for larger/brighter stars
        float glow = 0.0;
        if (uEnableGlow && vSize > 1.5) {
            glow = exp(-dist * 2.0) * 0.5;
        }

        float finalAlpha = (alpha + glow) * min(vBrightness, 1.0);
        vec3 finalColor = vColor * (1.0 + glow * 0.5);

        gl_FragColor = vec4(finalColor, finalAlpha);
    }
`;

// ═══════════════════════════════════════════════════════════════════════════════
// SHOOTING STAR SHADER - Fast Particles with Trails
// ═══════════════════════════════════════════════════════════════════════════════

export const shootingStarVertexShader = `
    attribute float aProgress;
    attribute float aSize;
    attribute vec3 aColor;

    uniform float uLife;

    varying float vProgress;
    varying float vAlpha;
    varying vec3 vColor;

    void main() {
        vProgress = aProgress;
        vColor = aColor;

        // Fade trail based on progress (head = 0, tail = 1)
        vAlpha = (1.0 - aProgress) * uLife;

        // Size tapers along trail
        float size = aSize * (1.0 - aProgress * 0.7);

        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * (200.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
    }
`;

export const shootingStarFragmentShader = `
    varying float vProgress;
    varying float vAlpha;
    varying vec3 vColor;

    void main() {
        vec2 coord = gl_PointCoord - 0.5;
        float dist = length(coord) * 2.0;

        if (dist > 1.0) discard;

        float alpha = 1.0 - smoothstep(0.0, 1.0, dist);

        // Bright core at head
        float core = exp(-dist * 3.0) * (1.0 - vProgress);

        vec3 color = mix(vColor, vec3(1.0), core * 0.5);
        float finalAlpha = (alpha + core * 0.5) * vAlpha;

        gl_FragColor = vec4(color, finalAlpha);
    }
`;

// ═══════════════════════════════════════════════════════════════════════════════
// CRYSTAL FILAMENT SHADER - Glowing Connecting Threads
// ═══════════════════════════════════════════════════════════════════════════════

export const filamentVertexShader = `
    attribute float aProgress;

    uniform float uTime;
    uniform float uPulseIntensity;

    varying float vProgress;
    varying float vGlow;

    void main() {
        vProgress = aProgress;

        // Traveling glow pulse along filament
        float travelPulse = sin(aProgress * 6.28 - uTime * 2.0) * 0.5 + 0.5;
        vGlow = 0.3 + travelPulse * 0.5 + uPulseIntensity * 0.5;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export const filamentFragmentShader = `
    uniform vec3 uColor;
    uniform float uOpacity;

    varying float vProgress;
    varying float vGlow;

    void main() {
        // Fade at ends
        float endFade = smoothstep(0.0, 0.1, vProgress) * smoothstep(1.0, 0.9, vProgress);

        vec3 color = uColor * (1.0 + vGlow * 0.5);
        float alpha = uOpacity * endFade * vGlow;

        gl_FragColor = vec4(color, alpha);
    }
`;

// ═══════════════════════════════════════════════════════════════════════════════
// NOVA FLASH SHADER - Expanding Spherical Flash
// ═══════════════════════════════════════════════════════════════════════════════

export const novaVertexShader = `
    varying vec2 vUv;

    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export const novaFragmentShader = `
    uniform float uOpacity;
    uniform vec3 uColor;
    uniform float uTime;

    varying vec2 vUv;

    void main() {
        vec2 center = vec2(0.5);
        float dist = length(vUv - center) * 2.0;

        // Soft expanding glow
        float glow = exp(-dist * 2.0);

        // Bright core
        float core = exp(-dist * 6.0) * 2.0;

        // Rays
        float angle = atan(vUv.y - 0.5, vUv.x - 0.5);
        float rays = pow(abs(sin(angle * 4.0 + uTime * 3.0)), 8.0) * 0.3;
        rays *= (1.0 - dist);

        vec3 color = uColor * glow + vec3(1.0) * core + uColor * rays;
        float alpha = (glow + core * 0.5 + rays) * uOpacity;

        gl_FragColor = vec4(color, alpha);
    }
`;

// ═══════════════════════════════════════════════════════════════════════════════
// ENERGY PULSE SHADER - Expanding Ring
// ═══════════════════════════════════════════════════════════════════════════════

export const energyPulseVertexShader = `
    varying vec2 vUv;

    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export const energyPulseFragmentShader = `
    uniform float uOpacity;
    uniform vec3 uColor;
    uniform float uProgress;

    varying vec2 vUv;

    void main() {
        vec2 center = vec2(0.5);
        float dist = length(vUv - center) * 2.0;

        // Ring shape
        float ringRadius = uProgress;
        float ringWidth = 0.15;
        float ring = smoothstep(ringRadius - ringWidth, ringRadius, dist) *
                     smoothstep(ringRadius + ringWidth, ringRadius, dist);

        // Inner glow
        float innerGlow = smoothstep(ringRadius, 0.0, dist) * 0.3;

        vec3 color = uColor;
        float alpha = (ring + innerGlow) * uOpacity;

        gl_FragColor = vec4(color, alpha);
    }
`;

// ═══════════════════════════════════════════════════════════════════════════════
// AMBIENT PARTICLE SHADER - Slow Floating Particles
// ═══════════════════════════════════════════════════════════════════════════════

export const ambientParticleVertexShader = `
    attribute float aSize;
    attribute float aPhase;
    attribute vec3 aColor;

    uniform float uTime;

    varying float vAlpha;
    varying vec3 vColor;

    void main() {
        vColor = aColor;

        // Gentle floating motion applied to position
        vec3 pos = position;
        pos.y += sin(uTime * 0.3 + aPhase * 6.28) * 8.0;
        pos.x += sin(uTime * 0.2 + aPhase * 4.0) * 6.0;
        pos.z += cos(uTime * 0.25 + aPhase * 5.0) * 6.0;

        // Pulsing opacity
        vAlpha = 0.3 + 0.3 * sin(uTime * 0.5 + aPhase * 6.28);

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_PointSize = aSize * (200.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
    }
`;

export const ambientParticleFragmentShader = `
    varying float vAlpha;
    varying vec3 vColor;

    void main() {
        vec2 coord = gl_PointCoord - 0.5;
        float dist = length(coord) * 2.0;

        if (dist > 1.0) discard;

        float glow = 1.0 - smoothstep(0.0, 1.0, dist);
        glow = pow(glow, 1.5);

        gl_FragColor = vec4(vColor * 1.5, vAlpha * glow);
    }
`;

// ═══════════════════════════════════════════════════════════════════════════════
// CHROMATIC ABERRATION POST-PROCESS SHADER
// ═══════════════════════════════════════════════════════════════════════════════

export const chromaticAberrationShader = {
    uniforms: {
        tDiffuse: { value: null },
        uStrength: { value: 0.0 },
        uTime: { value: 0.0 },
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
        uniform float uStrength;
        uniform float uTime;
        varying vec2 vUv;

        void main() {
            vec2 center = vec2(0.5);
            vec2 dir = vUv - center;
            float dist = length(dir);

            // Offset increases toward edges
            float offset = uStrength * dist * 0.01;

            // Sample RGB at different offsets
            float r = texture2D(tDiffuse, vUv + dir * offset).r;
            float g = texture2D(tDiffuse, vUv).g;
            float b = texture2D(tDiffuse, vUv - dir * offset).b;

            vec3 color = vec3(r, g, b);

            // Subtle white flash at high intensity
            if (uStrength > 4.0) {
                float flash = (uStrength - 4.0) * 0.03;
                color += vec3(flash);
            }

            gl_FragColor = vec4(color, 1.0);
        }
    `,
};
