/**
 * @fileoverview Earth Core Environment - Chapter 1 Visual Theme
 *
 * ENHANCED VERSION: Stunning volcanic Earth Core with:
 * - Animated molten lava floor with FBM noise shaders
 * - Volcanic crater rim with jagged rock formations
 * - Rising smoke/ash particles
 * - Enhanced magma balls with corona effects
 * - Improved lighting and atmosphere
 *
 * Design: Immersive volcanic core experience with realistic lava,
 * dramatic lighting, and cinematic visual effects.
 */

import * as THREE from 'three';
import { getChapterPathRange } from '../path-utils.js';

/**
 * Earth Core environment configuration
 */
export const EARTH_CORE_CONFIG = {
    id: 1,
    name: 'earth-core',
    yStart: -52.5,
    yEnd: -7.5,
    transitionZone: 0.005, // Faster fade out to clear lava colors before chapter 2
    colors: {
        primary: 0xff4400,
        secondary: 0x8b0000,
        tertiary: 0xffdd66,
        accent: 0xff6600,
        background: 0x0a0200,
    },
};

// Color palettes - warm volcanic spectrum
const VOLCANIC_PALETTES = [
    { main: new THREE.Color(0xff4400), glow: new THREE.Color(0xff6600) }, // Orange
    { main: new THREE.Color(0xff2200), glow: new THREE.Color(0xff4400) }, // Red-orange
    { main: new THREE.Color(0xffaa00), glow: new THREE.Color(0xffcc44) }, // Yellow-gold
    { main: new THREE.Color(0xff0000), glow: new THREE.Color(0xff2200) }, // Deep red
    { main: new THREE.Color(0xcc4400), glow: new THREE.Color(0xff6600) }, // Burnt orange
];

const EMBER_COLORS = [
    '#ff4400', '#ff6600', '#ff8800', '#ffaa00', '#ffcc00', // Oranges/yellows
    '#ff2200', '#ff3300', '#cc2200', '#aa1100', // Reds
    '#ffdd44', '#ffee66', // Bright yellows
];

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED NOISE GLSL - Simplex noise functions
// ═══════════════════════════════════════════════════════════════════════════════

const noiseGLSL = `
    vec3 mod289(vec3 x) { return x - floor(x / 289.0) * 289.0; }
    vec4 mod289(vec4 x) { return x - floor(x / 289.0) * 289.0; }
    vec4 permute(vec4 x) { return mod289((x * 34.0 + 1.0) * x); }
    vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - r * 0.85373472095314; }
    
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
        float f = 0.0;
        f += 0.5 * snoise(p); p *= 2.01;
        f += 0.25 * snoise(p); p *= 2.02;
        f += 0.125 * snoise(p); p *= 2.03;
        f += 0.0625 * snoise(p);
        return f;
    }
`;

// ═══════════════════════════════════════════════════════════════════════════════
// LAVA FLOOR SHADERS - Animated molten lava surface
// ═══════════════════════════════════════════════════════════════════════════════

const lavaFloorVertexShader = `
    uniform float uTime;
    uniform float uPulseIntensity;
    
    varying vec2 vUv;
    varying vec3 vPosition;
    varying float vElevation;
    
    ${noiseGLSL}
    
    void main() {
        vUv = uv;
        vec3 pos = position;
        
        // Animated displacement for bubbling/flowing effect
        float time = uTime * 0.3;
        float bubble = snoise(vec3(pos.xz * 0.1, time));
        float flow = snoise(vec3(pos.x * 0.05 + time * 0.5, pos.z * 0.05, time * 0.2));
        
        float displacement = bubble * 1.5 + flow * 0.8;
        displacement *= (1.0 + uPulseIntensity * 0.5);
        
        pos.y += displacement;
        vElevation = displacement;
        vPosition = pos;
        
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
`;

const lavaFloorFragmentShader = `
    uniform float uTime;
    uniform float uPulseIntensity;
    uniform vec3 uColorHot;      // Bright yellow-white (hottest)
    uniform vec3 uColorMid;      // Orange (medium)
    uniform vec3 uColorCool;     // Dark red/black (crust)
    
    varying vec2 vUv;
    varying vec3 vPosition;
    varying float vElevation;
    
    ${noiseGLSL}
    
    void main() {
        float time = uTime * 0.15;
        vec3 pos = vPosition;
        
        // Multi-layered turbulent noise for realistic lava
        float flow1 = fbm(pos * 0.3 + vec3(time, 0.0, time * 0.5));
        float flow2 = fbm(pos * 0.5 + vec3(-time * 0.3, time * 0.2, 0.0));
        float cracks = fbm(pos * 1.5 + vec3(time * 0.1, 0.0, time * 0.15));
        
        // Combine flows for temperature field
        float temp = (flow1 * 0.5 + flow2 * 0.3 + 0.5);
        temp += vElevation * 0.1; // Raised areas are hotter
        temp *= (1.0 + uPulseIntensity * 0.3);
        temp = clamp(temp, 0.0, 1.0);
        
        // Temperature-based color mixing
        vec3 color;
        if (temp > 0.65) {
            // Hottest - bright yellow-white
            color = mix(uColorMid, uColorHot, (temp - 0.65) / 0.35);
        } else if (temp > 0.35) {
            // Medium - orange
            color = mix(uColorCool, uColorMid, (temp - 0.35) / 0.3);
        } else {
            // Coolest - dark crust
            color = uColorCool * (temp / 0.35 + 0.2);
        }
        
        // Bright glowing veins/cracks
        float veinIntensity = smoothstep(0.35, 0.6, cracks);
        color += uColorHot * veinIntensity * 0.6;
        
        // Hot spots that pulse
        float hotSpot = pow(max(0.0, snoise(pos * 0.8 + time * 2.0)), 3.0);
        color += uColorHot * hotSpot * 0.4;
        
        // Circular edge fade for natural lava pool look
        float dist = length(vUv - 0.5) * 2.0;
        float alpha = 1.0 - smoothstep(0.7, 1.0, dist);
        
        // Emission boost for glow
        color *= 1.2 + uPulseIntensity * 0.3;
        
        gl_FragColor = vec4(color, alpha);
    }
`;

// ═══════════════════════════════════════════════════════════════════════════════
// VOLCANIC CRATER RIM SHADERS
// ═══════════════════════════════════════════════════════════════════════════════

const craterRimVertexShader = `
    varying vec3 vPosition;
    varying vec3 vNormal;
    varying vec2 vUv;
    
    void main() {
        vPosition = position;
        vNormal = normalize(normalMatrix * normal);
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const craterRimFragmentShader = `
    uniform float uTime;
    uniform float uPulseIntensity;
    uniform vec3 uLavaColor;
    
    varying vec3 vPosition;
    varying vec3 vNormal;
    varying vec2 vUv;
    
    ${noiseGLSL}
    
    void main() {
        // Dark volcanic rock - brighter for visibility
        vec3 darkRock = vec3(0.15, 0.08, 0.06);
        
        // Add subtle texture variation
        float rockNoise = fbm(vPosition * 0.8) * 0.3 + 0.7;
        vec3 rockColor = darkRock * rockNoise;
        
        // Subtle lava glow on underside (facing lava)
        float underGlow = max(0.0, -vNormal.y) * 0.5;
        rockColor += uLavaColor * underGlow * 0.25;
        
        gl_FragColor = vec4(rockColor, 1.0);
    }
`;

// ═══════════════════════════════════════════════════════════════════════════════
// SMOKE/ASH PARTICLE SHADERS
// ═══════════════════════════════════════════════════════════════════════════════

const smokeVertexShader = `
    uniform float uTime;
    attribute float aRandom;
    attribute float aSize;
    attribute float aSpeed;
    
    varying float vAlpha;
    varying float vRandom;
    
    void main() {
        vec3 pos = position;
        
        // Rise with time, looping
        float riseSpeed = aSpeed * 3.0;
        float yOffset = mod(uTime * riseSpeed + aRandom * 60.0, 80.0) - 10.0;
        pos.y += yOffset;
        
        // Expand and drift as it rises
        float lifeProgress = yOffset / 70.0;
        float spread = lifeProgress * 15.0;
        float angle = uTime * 0.3 + aRandom * 6.28;
        pos.x += sin(angle + pos.y * 0.02) * spread;
        pos.z += cos(angle * 0.7 + pos.y * 0.015) * spread * 0.8;
        
        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        
        // Size increases as smoke rises and expands
        float size = aSize * (1.0 + lifeProgress * 2.0);
        gl_PointSize = size * (200.0 / -mvPosition.z);
        gl_PointSize = clamp(gl_PointSize, 1.0, 30.0);
        
        // Fade out as it rises
        vAlpha = (1.0 - lifeProgress) * 0.4;
        vRandom = aRandom;
    }
`;

const smokeFragmentShader = `
    varying float vAlpha;
    varying float vRandom;
    
    void main() {
        float dist = length(gl_PointCoord - 0.5);
        if (dist > 0.5) discard;
        
        // Soft cloud-like falloff
        float glow = 1.0 - dist * 2.0;
        glow = pow(glow, 0.8);
        
        // Dark grey/black smoke with slight red tint
        vec3 color = mix(vec3(0.1, 0.05, 0.03), vec3(0.2, 0.1, 0.08), vRandom);
        
        gl_FragColor = vec4(color, glow * vAlpha);
    }
`;

// ═══════════════════════════════════════════════════════════════════════════════
// BACKGROUND & MAGMA BALL SHADERS (enhanced)
// ═══════════════════════════════════════════════════════════════════════════════

const volcanoBackgroundVertexShader = `
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

const volcanoBackgroundFragmentShader = `
    uniform float uTime;
    uniform float uPulseIntensity;
    
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vPosition;
    
    ${noiseGLSL}
    
    void main() {
        // Deep volcanic gradient
        vec3 core = vec3(0.08, 0.02, 0.0);
        vec3 outer = vec3(0.01, 0.002, 0.0);
        
        // Sphere-based gradient (darker at edges)
        float t = normalize(vPosition).y * 0.5 + 0.5;
        vec3 color = mix(outer, core, t);
        
        // Subtle animated glow from below (lava reflection)
        float lavaGlow = smoothstep(0.0, 0.5, -normalize(vPosition).y);
        float pulse = sin(uTime * 0.5) * 0.5 + 0.5;
        color += vec3(0.15, 0.03, 0.0) * lavaGlow * (0.5 + pulse * 0.5);
        color += vec3(0.1, 0.02, 0.0) * uPulseIntensity * lavaGlow;
        
        // Subtle noise for texture
        float noise = fbm(vPosition * 0.05 + uTime * 0.02) * 0.1;
        color += vec3(0.02, 0.005, 0.0) * noise;
        
        gl_FragColor = vec4(color, 1.0);
    }
`;

const magmaBallVertexShader = `
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vPosition;
    
    uniform float uTime;
    uniform float uPulseIntensity;
    
    ${noiseGLSL}
    
    void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vPosition = position;
        
        // Enhanced pulsing distortion
        vec3 pos = position;
        float pulse = sin(uTime * 2.0) * 0.08 * (1.0 + uPulseIntensity);
        float wave = snoise(pos * 2.0 + uTime * 1.5) * 0.1;
        pos += normal * (pulse + wave);
        
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
`;

const magmaBallFragmentShader = `
    uniform float uTime;
    uniform float uPulseIntensity;
    uniform vec3 uColorPrimary;    // Hot orange
    uniform vec3 uColorSecondary;  // Deep red
    uniform vec3 uColorTertiary;   // Yellow-white (hottest)
    
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vPosition;
    
    ${noiseGLSL}
    
    void main() {
        vec3 pos = vPosition * 2.0;
        
        // Animated lava flow pattern
        float flow = fbm(pos + vec3(0.0, uTime * 0.4, 0.0));
        float cracks = fbm(pos * 3.0 + vec3(uTime * 0.15, 0.0, uTime * 0.2));
        
        // Hot spots that pulse
        float hotSpots = pow(max(0.0, snoise(pos * 2.0 + uTime * 0.6)), 2.0);
        
        // Temperature gradient
        float temp = flow * 0.5 + 0.5 + hotSpots * 0.4;
        temp *= 1.0 + uPulseIntensity * 0.6;
        
        // Color mix based on temperature
        vec3 color;
        if (temp > 0.7) {
            color = mix(uColorPrimary, uColorTertiary, (temp - 0.7) / 0.3);
        } else if (temp > 0.4) {
            color = mix(uColorSecondary, uColorPrimary, (temp - 0.4) / 0.3);
        } else {
            color = uColorSecondary * (temp / 0.4);
        }
        
        // Add bright veins (lava cracks)
        float veins = smoothstep(0.3, 0.5, cracks) * 0.6;
        color += uColorTertiary * veins;
        
        // Enhanced fresnel glow at edges
        float fresnel = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 2.5);
        color += uColorPrimary * fresnel * 0.8;
        
        // Emission boost
        color *= 1.1 + uPulseIntensity * 0.2;
        
        gl_FragColor = vec4(color, 1.0);
    }
`;

const emberStarVertexShader = `
    uniform float uTime;
    uniform float uPulseIntensity;
    attribute float aSize;
    attribute float aTwinklePhase;
    attribute float aTwinkleSpeed;
    attribute float aBrightness;
    attribute vec3 aColor;
    
    varying vec3 vColor;
    varying float vBrightness;
    
    void main() {
        vColor = aColor;
        
        // Twinkle effect
        float twinkle = sin(uTime * aTwinkleSpeed + aTwinklePhase) * 0.3 + 0.7;
        vBrightness = aBrightness * twinkle * (1.0 + uPulseIntensity * 0.5);
        
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        
        // Size attenuation
        float size = aSize * (1.0 + uPulseIntensity * 0.3);
        gl_PointSize = size * (250.0 / -mvPosition.z);
        gl_PointSize = clamp(gl_PointSize, 0.5, 15.0);
    }
`;

const emberStarFragmentShader = `
    varying vec3 vColor;
    varying float vBrightness;
    
    void main() {
        float dist = length(gl_PointCoord - 0.5);
        if (dist > 0.5) discard;
        
        // Soft glow falloff
        float glow = 1.0 - dist * 2.0;
        glow = pow(glow, 1.5);
        
        // Hot core
        vec3 color = vColor;
        float core = smoothstep(0.2, 0.0, dist);
        color = mix(color, vec3(1.0, 0.95, 0.85), core * 0.5);
        
        gl_FragColor = vec4(color * glow * vBrightness, glow * vBrightness);
    }
`;

const risingEmberVertexShader = `
    uniform float uTime;
    attribute float aRandom;
    attribute float aSize;
    varying float vAlpha;
    varying vec3 vColor;
    
    void main() {
        vec3 pos = position;
        
        // Rise with time, looping
        float riseSpeed = 1.5 + aRandom * 2.5;
        float yOffset = mod(uTime * riseSpeed + aRandom * 40.0, 50.0) - 25.0;
        pos.y += yOffset;
        
        // Gentle spiral drift
        float angle = uTime * 0.4 + aRandom * 6.28;
        float radius = 1.5 + aRandom * 3.0;
        pos.x += sin(angle + pos.y * 0.05) * radius;
        pos.z += cos(angle * 0.7 + pos.y * 0.04) * radius * 0.8;
        
        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        
        // Size decreases as they rise
        float normalizedY = (yOffset + 25.0) / 50.0;
        float size = aSize * (1.0 - normalizedY * 0.5);
        gl_PointSize = size * (180.0 / -mvPosition.z);
        gl_PointSize = clamp(gl_PointSize, 0.5, 12.0);
        
        // Fade out as they rise
        vAlpha = (1.0 - normalizedY) * (0.6 + aRandom * 0.4);
        
        // Orange to yellow gradient
        float colorMix = aRandom;
        vColor = mix(vec3(1.0, 0.25, 0.0), vec3(1.0, 0.55, 0.1), colorMix);
    }
`;

const risingEmberFragmentShader = `
    varying float vAlpha;
    varying vec3 vColor;
    
    void main() {
        float dist = length(gl_PointCoord - 0.5);
        if (dist > 0.5) discard;
        
        float glow = 1.0 - dist * 2.0;
        glow = pow(glow, 1.8);
        
        // Hot white center
        vec3 color = vColor;
        float core = smoothstep(0.2, 0.0, dist);
        color = mix(color, vec3(1.0, 0.95, 0.85), core * 0.5);
        
        gl_FragColor = vec4(color * glow, glow * vAlpha);
    }
`;

// ═══════════════════════════════════════════════════════════════════════════════
// Environment Creation
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create the Earth Core environment group
 */
export function createEarthCoreEnvironment(options = {}) {
    const group = new THREE.Group();
    group.name = 'earth-core-environment';
    group.userData.chapterId = 1;
    group.userData.yStart = EARTH_CORE_CONFIG.yStart;
    group.userData.yEnd = EARTH_CORE_CONFIG.yEnd;
    const chapterRange = getChapterPathRange(1);
    const fallbackCenterY = (EARTH_CORE_CONFIG.yStart + EARTH_CORE_CONFIG.yEnd) / 2;
    const chapterCenterY = chapterRange?.center.y ?? fallbackCenterY;
    if (chapterRange) {
        group.userData.yStart = chapterRange.start.y;
        group.userData.yEnd = chapterRange.end.y;
    }

    // Shared uniforms
    const uniforms = {
        uTime: { value: 0 },
        uPulseIntensity: { value: 0 },
    };
    group.userData.uniforms = uniforms;

    // Storage for elements
    const elements = {
        rockClusters: [],
        filaments: [],
    };
    group.userData.elements = elements;

    // 1. Create background sphere (enhanced with lava glow)
    const background = createVolcanoBackground(uniforms);
    group.add(background);

    // 2. Create animated lava floor - THE MAIN FEATURE
    const lavaFloor = createLavaFloor(uniforms);
    group.add(lavaFloor);
    group.userData.lavaFloor = lavaFloor;

    // 3. Create volcanic crater rim - VOLUMETRIC PARTICLE SYSTEM
    const craterRim = createParticleCraterRim(uniforms);
    group.add(craterRim);

    // 4. Create volcanic rock clusters (positioned in upper sphere area)
    const clusterCount = Math.min(options.particleCount ? Math.floor(options.particleCount / 30) : 12, 15);
    createVolcanicRockClusters(group, uniforms, elements, clusterCount);

    // 5. Create ember stars (background sparkle)
    const starCount = options.particleCount ? options.particleCount * 12 : 6000;
    const stars = createEmberStars(uniforms, starCount);
    group.add(stars);
    group.userData.stars = stars;

    // 6. Create rising ember particles
    const risingEmbers = createRisingEmbers(uniforms, 500);
    group.add(risingEmbers);
    group.userData.risingEmbers = risingEmbers;

    // 7. Create volcanic smoke/ash particles
    const smoke = createVolcanicSmoke(uniforms, 300);
    group.add(smoke);
    group.userData.smoke = smoke;

    // 8. Setup enhanced volcanic lighting
    setupVolcanicLighting(group);

    // Position the environment
    group.position.y = chapterCenterY;

    return group;
}

/**
 * Create animated lava floor - the centerpiece of the chapter
 */
function createLavaFloor(uniforms) {
    const group = new THREE.Group();
    group.name = 'lava-floor';

    // Main lava surface plane
    const geometry = new THREE.PlaneGeometry(100, 100, 64, 64);
    geometry.rotateX(-Math.PI / 2); // Horizontal

    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: uniforms.uTime,
            uPulseIntensity: uniforms.uPulseIntensity,
            uColorHot: { value: new THREE.Color(0xffffaa) }, // Yellow-white
            uColorMid: { value: new THREE.Color(0xff6600) }, // Orange
            uColorCool: { value: new THREE.Color(0x330000) }, // Dark red/black
        },
        vertexShader: lavaFloorVertexShader,
        fragmentShader: lavaFloorFragmentShader,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: true, // Enable depth writing to hide objects behind lava
        blending: THREE.AdditiveBlending,
    });

    const lavaSurface = new THREE.Mesh(geometry, material);
    lavaSurface.position.y = -5; // Positioned closer to camera to be visible at bottom of screen
    group.add(lavaSurface);

    // Add glow layers beneath for atmospheric effect
    const glowTexture = createLavaGlowTexture();

    // Large ambient glow
    const ambientGlow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0xff4400,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    }));
    ambientGlow.scale.set(180, 180, 1);
    ambientGlow.position.y = -7; // Adjusted to match lava floor at y=-5
    ambientGlow.rotation.x = -Math.PI / 2;
    group.add(ambientGlow);

    // Inner bright glow
    const innerGlow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0xffaa00,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    }));
    innerGlow.scale.set(100, 100, 1);
    innerGlow.position.y = -6; // Adjusted to match lava floor at y=-5
    innerGlow.rotation.x = -Math.PI / 2;
    group.add(innerGlow);

    group.userData.glows = [ambientGlow, innerGlow];
    group.userData.surface = lavaSurface;

    return group;
}

/**
 * Create volcanic crater rim with jagged rock formations
 */
/**
 * Create volcanic crater rim using Volumetric Particles
 * Replaces the mesh-based rim to avoid hard edges and lighting artifacts.
 */
function createParticleCraterRim(uniforms) {
    const group = new THREE.Group();
    group.name = 'crater-rim-particles';

    // 1. Generate Particle Data
    const particleCount = 800;
    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const sizes = [];
    const colors = [];

    // Base color: Deeper, richer volcanic tone (Less blown out)
    const baseColor = new THREE.Color(0xcc2200); // Deep Rust Red
    const glowColor = new THREE.Color(0xff5500); // Orange (removed yellow)

    const radiusBase = 55;
    const tubeRadius = 9;

    for (let i = 0; i < particleCount; i++) {
        // Distribute in a torus volume
        const angle = Math.random() * Math.PI * 2;

        // Random offset within the tube volume
        const rOffset = (Math.random() - 0.5) * tubeRadius * 2;
        const widthSpread = (Math.random() - 0.5) * tubeRadius * 3; // Wider spread horizontally

        const r = radiusBase + widthSpread;

        const x = Math.cos(angle) * r;
        const z = Math.sin(angle) * r;
        // Height variation - gently undulating
        const y = -3 + (Math.random() - 0.5) * 6;

        positions.push(x, y, z);

        // Size variation
        sizes.push(10 + Math.random() * 15);

        // Color variation based on height
        // Lower particles = closer to lava = more orange/glow
        // Higher particles = cooler/darker
        const heightFactor = (y + 6) / 12; // 0 to 1 mapping approx
        const mixFactor = (1.0 - heightFactor) ** 2.0 * 0.6; // Bias towards bottom

        const pColor = baseColor.clone().lerp(glowColor, mixFactor);
        colors.push(pColor.r, pColor.g, pColor.b);
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    // 2. Material
    const texture = createCloudTexture();

    const material = new THREE.PointsMaterial({
        size: 1,
        map: texture,
        vertexColors: true,
        transparent: true,
        opacity: 0.2, // Reduced from 0.4 to prevent blowout
        sizeAttenuation: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending, // STABLE GLOW (No pop, consistent look)
        fog: false, // STABLE COLOR (No graying out by fog)
    });

    // HACK: To support per-point size with standard material, we usually just set a constant large size.
    // Or we stick to the plan: Volumetric "Cloud". Constant size is often fine for clouds if we have enough of them.
    material.size = 25; // Large puff size

    const particles = new THREE.Points(geometry, material);
    group.add(particles);

    // 3. Add a few "Spire" shadows?
    // The previously used "spires" were mesh cones.
    // If the user wants "better edges", maybe we keep the spires but make them dark silhouettes?
    // Let's keep the scene clean first. The particles are the rim.

    return group;
}

/**
 * Generate a soft radial gradient texture for cloud particles
 */
function createCloudTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    // Soft white puff center
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    // Fade out
    gradient.addColorStop(0.4, 'rgba(255, 255, 255, 0.4)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0.0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);

    const texture = new THREE.CanvasTexture(canvas);
    return texture;
}

/**
 * Create texture for fog ring with vertical gradient
 */
function createFogRingTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    // Vertical gradient:
    // Bottom: Solid! (To block rim from below)
    // Middle: Solid (to block horizon)
    // Top: Transparent (to fade into sky)
    const gradient = ctx.createLinearGradient(0, 0, 0, 128);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0)'); // Top - fully transparent
    gradient.addColorStop(0.15, 'rgba(255, 255, 255, 0.5)'); // Upper fade starts quickly
    gradient.addColorStop(0.4, 'rgba(255, 255, 255, 0.95)'); // Middle - nearly solid
    gradient.addColorStop(0.8, 'rgba(255, 255, 255, 1.0)'); // Lower - solid
    gradient.addColorStop(1, 'rgba(255, 255, 255, 1.0)'); // Bottom - solid

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 128);

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    return texture;
}

/**
 * Create volcanic smoke/ash particles rising from the lava
 */
function createVolcanicSmoke(uniforms, count) {
    const geometry = new THREE.BufferGeometry();

    const positions = new Float32Array(count * 3);
    const randoms = new Float32Array(count);
    const sizes = new Float32Array(count);
    const speeds = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        // Spawn in a ring around the lava center
        const angle = Math.random() * Math.PI * 2;
        const radius = 10 + Math.random() * 35;

        positions[i * 3] = Math.cos(angle) * radius;
        positions[i * 3 + 1] = -5; // Start at lava level
        positions[i * 3 + 2] = Math.sin(angle) * radius;

        randoms[i] = Math.random();
        sizes[i] = 4 + Math.random() * 8;
        speeds[i] = 0.3 + Math.random() * 0.7;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));

    const material = new THREE.ShaderMaterial({
        uniforms: { uTime: uniforms.uTime },
        vertexShader: smokeVertexShader,
        fragmentShader: smokeFragmentShader,
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending,
    });

    const smoke = new THREE.Points(geometry, material);
    smoke.name = 'volcanic-smoke';
    return smoke;
}

/**
 * Volcanic background sphere (enhanced)
 */
function createVolcanoBackground(uniforms) {
    const geometry = new THREE.SphereGeometry(250, 48, 32);
    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: uniforms.uTime,
            uPulseIntensity: uniforms.uPulseIntensity,
        },
        vertexShader: volcanoBackgroundVertexShader,
        fragmentShader: volcanoBackgroundFragmentShader,
        side: THREE.BackSide,
    });

    const sphere = new THREE.Mesh(geometry, material);
    sphere.name = 'volcano-background';
    sphere.renderOrder = -90; // Draw behind scene but in front of ocean (-100) if needed
    material.depthWrite = false; // Prevent occlusion of other backgrounds
    return sphere;
}

/**
 * Create volcanic rock clusters distributed in upper sphere area
 */
function createVolcanicRockClusters(group, uniforms, elements, count) {
    const radius = 90;

    for (let i = 0; i < count; i++) {
        // Fibonacci sphere distribution, but biased to upper hemisphere
        const phi = Math.acos(1 - 2 * (i + 0.5) / count);
        const theta = Math.PI * (1 + Math.sqrt(5)) * i;

        // Only place in upper hemisphere and sides
        if (phi < Math.PI * 0.7) {
            const r = radius * (0.85 + Math.random() * 0.3);

            // Bias Y position lower - closer to lava
            // Previous: r * Math.cos(phi) + 10 (High bias)
            // New: Clamp max height to avoid bleeding into Chapter 2
            let yPos = r * Math.cos(phi) * 0.5 - 5;

            // Hard clamp ceiling to ensure they don't go too high
            // Chapter top is technically around 20 local units
            if (yPos > 25) yPos = 25 - Math.random() * 10;

            // Ensure all balls are above the lava floor (y=-5)
            if (yPos < -2) yPos = -2 + Math.random() * 15;

            const position = new THREE.Vector3(
                r * Math.sin(phi) * Math.cos(theta),
                yPos,
                r * Math.sin(phi) * Math.sin(theta),
            );

            const cluster = createRockCluster(uniforms, position);
            group.add(cluster);
            elements.rockClusters.push(cluster);
        }
    }
}

/**
 * Create a single magma ball with enhanced glow sprites
 */
function createRockCluster(uniforms, position) {
    const size = 4 + Math.random() * 8;
    const ballGroup = new THREE.Group();

    // Enhanced magma ball with corona effect
    const geometry = new THREE.SphereGeometry(size, 32, 32);
    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: uniforms.uTime,
            uPulseIntensity: uniforms.uPulseIntensity,
            uColorPrimary: { value: new THREE.Color(0xff6600) },
            uColorSecondary: { value: new THREE.Color(0x8b0000) },
            uColorTertiary: { value: new THREE.Color(0xffee88) },
        },
        vertexShader: magmaBallVertexShader,
        fragmentShader: magmaBallFragmentShader,
        transparent: false,
        side: THREE.FrontSide,
    });

    const coreMesh = new THREE.Mesh(geometry, material);
    ballGroup.add(coreMesh);

    // Create glow texture
    const glowTexture = createGlowTexture();

    // Inner corona glow
    const innerGlow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0xFFCC00,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    }));
    innerGlow.scale.set(size * 3.5, size * 3.5, 1);
    ballGroup.add(innerGlow);

    // Middle glow
    const midGlow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0xFF6600,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    }));
    midGlow.scale.set(size * 5, size * 5, 1);
    ballGroup.add(midGlow);

    // Outer halo
    const outerGlow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0xFF2200,
        transparent: true,
        opacity: 0.25,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    }));
    outerGlow.scale.set(size * 7, size * 7, 1);
    ballGroup.add(outerGlow);

    ballGroup.position.copy(position);
    ballGroup.userData.glows = [innerGlow, midGlow, outerGlow];
    ballGroup.userData.size = size;

    return ballGroup;
}

/**
 * Create thousands of ember stars
 */
function createEmberStars(uniforms, count) {
    const geometry = new THREE.BufferGeometry();

    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const twinklePhases = new Float32Array(count);
    const twinkleSpeeds = new Float32Array(count);
    const brightnesses = new Float32Array(count);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
        // Distribute within the volcanic cavity
        const r = 15 + Math.random() * 70;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);

        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.cos(phi);
        positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

        // Size - smaller embers more common
        const sizeBias = Math.random() ** 2;
        sizes[i] = 0.4 + sizeBias * 2.5;

        // Twinkle
        twinklePhases[i] = Math.random() * Math.PI * 2;
        twinkleSpeeds[i] = 2 + Math.random() * 4;

        // Brightness
        brightnesses[i] = 0.3 + Math.random() * 0.7;

        // Color from palette
        const color = new THREE.Color(
            EMBER_COLORS[Math.floor(Math.random() * EMBER_COLORS.length)],
        );
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aTwinklePhase', new THREE.BufferAttribute(twinklePhases, 1));
    geometry.setAttribute('aTwinkleSpeed', new THREE.BufferAttribute(twinkleSpeeds, 1));
    geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightnesses, 1));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: uniforms.uTime,
            uPulseIntensity: uniforms.uPulseIntensity,
        },
        vertexShader: emberStarVertexShader,
        fragmentShader: emberStarFragmentShader,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });

    const stars = new THREE.Points(geometry, material);
    stars.name = 'ember-stars';
    return stars;
}

/**
 * Create curated rising ember particles
 */
function createRisingEmbers(uniforms, count) {
    const geometry = new THREE.BufferGeometry();

    const positions = new Float32Array(count * 3);
    const randoms = new Float32Array(count);
    const sizes = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        const i3 = i * 3;

        // Spread embers in a cylinder around the lava pool
        const theta = Math.random() * Math.PI * 2;
        const radius = 5 + Math.random() * 45; // Wider spread from lava

        positions[i3] = Math.cos(theta) * radius;
        positions[i3 + 1] = -5 + (Math.random() - 0.5) * 10; // Start near lava
        positions[i3 + 2] = Math.sin(theta) * radius;

        randoms[i] = Math.random();
        sizes[i] = 3.0 + Math.random() * 5.0;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.ShaderMaterial({
        uniforms: { uTime: uniforms.uTime },
        vertexShader: risingEmberVertexShader,
        fragmentShader: risingEmberFragmentShader,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });

    const embers = new THREE.Points(geometry, material);
    embers.name = 'rising-embers';
    return embers;
}

/**
 * Create radial glow texture
 */
function createGlowTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255, 200, 100, 1.0)');
    gradient.addColorStop(0.2, 'rgba(255, 120, 50, 0.8)');
    gradient.addColorStop(0.4, 'rgba(200, 50, 20, 0.4)');
    gradient.addColorStop(0.7, 'rgba(100, 20, 10, 0.15)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);

    return new THREE.CanvasTexture(canvas);
}

/**
 * Create lava-specific glow texture (larger, softer)
 */
function createLavaGlowTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, 'rgba(255, 180, 80, 1.0)');
    gradient.addColorStop(0.15, 'rgba(255, 100, 30, 0.9)');
    gradient.addColorStop(0.35, 'rgba(200, 50, 10, 0.5)');
    gradient.addColorStop(0.6, 'rgba(100, 20, 0, 0.2)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);

    return new THREE.CanvasTexture(canvas);
}

/**
 * Setup enhanced volcanic lighting
 */
function setupVolcanicLighting(group) {
    // Warm ambient - slightly brighter for visibility
    const ambient = new THREE.AmbientLight(0x200800, 0.25); // Reduced ambient
    group.add(ambient);

    // Central lava floor point light (main light source)
    const lavaLight = new THREE.PointLight(0xff4400, 2.5, 200);
    lavaLight.position.set(0, 0, 0); // Positioned above lava at y=-5
    group.add(lavaLight);
    group.userData.lavaLight = lavaLight;

    // Secondary lava glow (softer, larger radius)
    const lavaGlow = new THREE.PointLight(0xff6600, 1.2, 300);
    lavaGlow.position.set(0, -2, 0); // Positioned above lava at y=-5
    group.add(lavaGlow);
    group.userData.lavaGlow = lavaGlow;

    // Accent rim lights around the crater
    const accentColors = [0xff6600, 0xff2200, 0xffaa00, 0xff4400];
    group.userData.accentLights = [];

    for (let i = 0; i < 4; i++) {
        const light = new THREE.PointLight(accentColors[i], 0.7, 80);
        const angle = (i / 4) * Math.PI * 2;
        light.position.set(
            Math.cos(angle) * 55,
            0, // Positioned at rim level (rim at y=-3)
            Math.sin(angle) * 55,
        );
        group.add(light);
        group.userData.accentLights.push(light);
    }
}

/**
 * Update Earth Core environment animations
 */
export function updateEarthCoreEnvironment(group, delta, time, camera = null, cameraProgress = null, directorState = null) {
    const { uniforms } = group.userData;
    if (uniforms?.uTime) {
        uniforms.uTime.value = time;
    }

    if (uniforms?.uPulseIntensity) {
        const audioPulse = directorState
            ? THREE.MathUtils.clamp((directorState.bass || 0) * 0.7 + (directorState.energy || 0) * 0.3, 0, 1)
            : 0;
        uniforms.uPulseIntensity.value = Math.max(
            uniforms.uPulseIntensity.value * Math.exp(-Math.max(0, delta) * 3.2),
            audioPulse,
        );
    }

    // Animate lava floor glow sprites
    const { lavaFloor } = group.userData;
    if (lavaFloor?.userData.glows) {
        const pulse = 1 + Math.sin(time * 1.2) * 0.15;
        const baseScales = [180, 100];
        lavaFloor.userData.glows.forEach((sprite, i) => {
            sprite.scale.setScalar(baseScales[i] * pulse);
        });
    }

    // Animate lava lights
    const { lavaLight } = group.userData;
    if (lavaLight) {
        lavaLight.intensity = 4 + Math.sin(time * 2.5) * 1 + Math.sin(time * 4.3) * 0.5;
    }

    const { lavaGlow } = group.userData;
    if (lavaGlow) {
        lavaGlow.intensity = 2 + Math.sin(time * 1.8) * 0.5;
    }

    // Animate accent lights with flickering
    const { accentLights } = group.userData;
    if (accentLights) {
        accentLights.forEach((light, i) => {
            const flicker = Math.sin(time * 3 + i * 1.5) * 0.3
                + Math.sin(time * 7 + i * 2.5) * 0.15;
            light.intensity = 1.2 + flicker;
        });
    }

    // Slow rotation of magma balls
    const { elements } = group.userData;
    if (elements?.rockClusters) {
        elements.rockClusters.forEach((cluster, i) => {
            cluster.rotation.y += delta * 0.03 * ((i % 2) * 2 - 1);

            // Pulse glow sprites
            if (cluster.userData.glows) {
                const pulse = 1 + Math.sin(time * 2 + i * 0.5) * 0.15;
                const baseScales = [cluster.userData.size * 3.5, cluster.userData.size * 5, cluster.userData.size * 7];
                cluster.userData.glows.forEach((sprite, j) => {
                    sprite.scale.setScalar(baseScales[j] * pulse);
                });
            }
        });
    }
}

export default {
    config: EARTH_CORE_CONFIG,
    create: createEarthCoreEnvironment,
    update: updateEarthCoreEnvironment,
};
