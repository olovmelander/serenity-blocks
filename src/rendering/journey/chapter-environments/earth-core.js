/**
 * @fileoverview Earth Core Environment - Chapter 1 Visual Theme
 * 
 * Geode-inspired volcanic Earth Core with dramatic 3D formations,
 * lava rock clusters, ember stars, magma filaments, and glowing effects.
 * 
 * Design: Large sphere shell of volcanic rock formations surrounding the path,
 * with thousands of ember stars and flowing magma energy lines.
 */

import * as THREE from 'three';

/**
 * Earth Core environment configuration
 */
export const EARTH_CORE_CONFIG = {
    id: 1,
    name: 'earth-core',
    yStart: -35,
    yEnd: -5,
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
    '#ff2200', '#ff3300', '#cc2200', '#aa1100',            // Reds
    '#ffdd44', '#ffee66',                                   // Bright yellows
];

// ═══════════════════════════════════════════════════════════════════════════════
// GLSL Shaders
// ═══════════════════════════════════════════════════════════════════════════════

const volcanoBackgroundVertexShader = `
    varying vec2 vUv;
    varying vec3 vNormal;
    
    void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const volcanoBackgroundFragmentShader = `
    uniform float uTime;
    uniform float uPulseIntensity;
    
    varying vec2 vUv;
    varying vec3 vNormal;
    
    void main() {
        // Subtle volcanic gradient - much darker for path visibility
        vec3 core = vec3(0.06, 0.01, 0.0);
        vec3 outer = vec3(0.01, 0.002, 0.0);
        
        float dist = length(vUv - 0.5) * 2.0;
        vec3 color = mix(core, outer, dist);
        
        // Very subtle pulsing
        float pulse = sin(uTime * 0.5) * 0.5 + 0.5;
        color += vec3(0.03, 0.005, 0.0) * pulse * (1.0 - dist) * 0.2;
        
        gl_FragColor = vec4(color, 0.6);
    }
`;

const magmaBallVertexShader = `
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vPosition;
    
    uniform float uTime;
    uniform float uPulseIntensity;
    
    void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vPosition = position;
        
        // Pulsing distortion
        vec3 pos = position;
        float pulse = sin(uTime * 2.0) * 0.05 * (1.0 + uPulseIntensity);
        float wave = sin(pos.x * 3.0 + uTime * 2.0) * sin(pos.y * 3.0 + uTime * 1.5) * 0.08;
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
    
    // Simplex noise
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
    
    void main() {
        vec3 pos = vPosition * 2.0;
        
        // Animated lava flow pattern
        float flow = fbm(pos + vec3(0.0, uTime * 0.3, 0.0));
        float cracks = fbm(pos * 3.0 + vec3(uTime * 0.1, 0.0, uTime * 0.15));
        
        // Hot spots that pulse
        float hotSpots = pow(max(0.0, snoise(pos * 2.0 + uTime * 0.5)), 2.0);
        
        // Temperature gradient
        float temp = flow * 0.5 + 0.5 + hotSpots * 0.3;
        temp *= 1.0 + uPulseIntensity * 0.5;
        
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
        float veins = smoothstep(0.3, 0.5, cracks) * 0.5;
        color += uColorTertiary * veins;
        
        // Fresnel glow at edges
        float fresnel = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 2.0);
        color += uColorPrimary * fresnel * 0.5;
        
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

    // Create background sphere
    const background = createVolcanoBackground(uniforms);
    group.add(background);

    // Create volcanic rock clusters (fewer, positioned away from center)
    const clusterCount = Math.min(options.particleCount ? Math.floor(options.particleCount / 30) : 15, 20);
    createVolcanicRockClusters(group, uniforms, elements, clusterCount);

    // Create ember stars (background sparkle)
    const starCount = options.particleCount ? options.particleCount * 15 : 8000;
    const stars = createEmberStars(uniforms, starCount);
    group.add(stars);
    group.userData.stars = stars;

    // Create rising ember particles (curated embers)
    const risingEmbers = createRisingEmbers(uniforms, 400);
    group.add(risingEmbers);
    group.userData.risingEmbers = risingEmbers;

    // Create central lava core (smaller, positioned down)
    const lavaCore = createCentralLavaCore(uniforms);
    group.add(lavaCore);

    // Setup lighting (dimmer)
    setupVolcanicLighting(group);

    // Position the environment
    group.position.y = (EARTH_CORE_CONFIG.yStart + EARTH_CORE_CONFIG.yEnd) / 2;

    return group;
}

/**
 * Volcanic background sphere
 */
function createVolcanoBackground(uniforms) {
    const geometry = new THREE.SphereGeometry(250, 32, 24);
    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: uniforms.uTime,
            uPulseIntensity: uniforms.uPulseIntensity,
        },
        vertexShader: volcanoBackgroundVertexShader,
        fragmentShader: volcanoBackgroundFragmentShader,
        side: THREE.BackSide,
        transparent: true,
    });

    const sphere = new THREE.Mesh(geometry, material);
    sphere.name = 'volcano-background';
    return sphere;
}

/**
 * Create volcanic rock clusters distributed in a sphere
 */
function createVolcanicRockClusters(group, uniforms, elements, count) {
    const radius = 100; // Distance from center - further out

    for (let i = 0; i < count; i++) {
        // Fibonacci sphere distribution for even spacing
        const phi = Math.acos(1 - 2 * (i + 0.5) / count);
        const theta = Math.PI * (1 + Math.sqrt(5)) * i;

        const r = radius * (0.85 + Math.random() * 0.3);
        const position = new THREE.Vector3(
            r * Math.sin(phi) * Math.cos(theta),
            r * Math.cos(phi),
            r * Math.sin(phi) * Math.sin(theta)
        );

        const cluster = createRockCluster(uniforms, position);
        group.add(cluster);
        elements.rockClusters.push(cluster);
    }
}

/**
 * Create a single magma ball with glow sprites (Cinder Drift style)
 */
function createRockCluster(uniforms, position) {
    // Now creates a single magma ball instead of rock cluster
    const size = 4 + Math.random() * 8;
    const ballGroup = new THREE.Group();

    // Use smooth sphere for magma ball
    const geometry = new THREE.SphereGeometry(size, 32, 32);
    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: uniforms.uTime,
            uPulseIntensity: uniforms.uPulseIntensity,
            uColorPrimary: { value: new THREE.Color(0xff6600) },   // Hot orange
            uColorSecondary: { value: new THREE.Color(0x8b0000) }, // Deep red
            uColorTertiary: { value: new THREE.Color(0xffdd66) },  // Yellow-white
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

    // Inner glow
    const innerGlow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0xFFAA00,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    }));
    innerGlow.scale.set(size * 3.5, size * 3.5, 1);
    ballGroup.add(innerGlow);

    // Outer glow
    const outerGlow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0xFF4400,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    }));
    outerGlow.scale.set(size * 5, size * 5, 1);
    ballGroup.add(outerGlow);

    // Halo glow
    const haloGlow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0x880000,
        transparent: true,
        opacity: 0.2,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    }));
    haloGlow.scale.set(size * 7, size * 7, 1);
    ballGroup.add(haloGlow);

    ballGroup.position.copy(position);
    ballGroup.userData.glows = [innerGlow, outerGlow, haloGlow];
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
        const sizeBias = Math.pow(Math.random(), 2);
        sizes[i] = 0.4 + sizeBias * 2.5;

        // Twinkle
        twinklePhases[i] = Math.random() * Math.PI * 2;
        twinkleSpeeds[i] = 2 + Math.random() * 4;

        // Brightness
        brightnesses[i] = 0.3 + Math.random() * 0.7;

        // Color from palette
        const color = new THREE.Color(
            EMBER_COLORS[Math.floor(Math.random() * EMBER_COLORS.length)]
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

        // Spread embers in a cylinder around the center
        const theta = Math.random() * Math.PI * 2;
        const radius = 5 + Math.random() * 30;

        positions[i3] = Math.cos(theta) * radius;
        positions[i3 + 1] = -20 + (Math.random() - 0.5) * 15;
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
 * Central glowing lava core
 */
function createCentralLavaCore(uniforms) {
    const coreGroup = new THREE.Group();
    coreGroup.name = 'lava-core';

    // Glowing sphere
    const geometry = new THREE.SphereGeometry(8, 32, 32);
    const material = new THREE.MeshBasicMaterial({
        color: 0xff4400,
        transparent: true,
        opacity: 0.9,
    });
    const core = new THREE.Mesh(geometry, material);
    coreGroup.add(core);

    // Glow sprite layers
    const glowTexture = createGlowTexture();

    const innerGlow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0xffaa00,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    }));
    innerGlow.scale.set(40, 40, 1);
    coreGroup.add(innerGlow);

    const outerGlow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0xff4400,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    }));
    outerGlow.scale.set(70, 70, 1);
    coreGroup.add(outerGlow);

    const haloGlow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0x880000,
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    }));
    haloGlow.scale.set(100, 100, 1);
    coreGroup.add(haloGlow);

    coreGroup.userData.glows = [innerGlow, outerGlow, haloGlow];
    coreGroup.position.y = -15;

    return coreGroup;
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
 * Setup volcanic lighting
 */
function setupVolcanicLighting(group) {
    // Warm ambient
    const ambient = new THREE.AmbientLight(0x200800, 0.4);
    group.add(ambient);

    // Central lava glow
    const coreLight = new THREE.PointLight(0xff4400, 3, 150);
    coreLight.position.set(0, -15, 0);
    group.add(coreLight);
    group.userData.coreLight = coreLight;

    // Accent lights at edges
    const accentColors = [0xff6600, 0xff2200, 0xffaa00];
    for (let i = 0; i < 3; i++) {
        const light = new THREE.PointLight(accentColors[i], 1, 100);
        const angle = (i / 3) * Math.PI * 2;
        light.position.set(
            Math.cos(angle) * 50,
            -10 + Math.random() * 20,
            Math.sin(angle) * 50
        );
        group.add(light);
    }
}

/**
 * Update Earth Core environment animations
 */
export function updateEarthCoreEnvironment(group, delta, time) {
    const uniforms = group.userData.uniforms;
    if (uniforms?.uTime) {
        uniforms.uTime.value = time;
    }

    // Decay pulse intensity
    if (uniforms?.uPulseIntensity && uniforms.uPulseIntensity.value > 0) {
        uniforms.uPulseIntensity.value *= 0.95;
    }

    // Pulse core light
    const coreLight = group.userData.coreLight;
    if (coreLight) {
        coreLight.intensity = 3 + Math.sin(time * 2) * 0.5;
    }

    // Pulse glow sprites
    const lavaCore = group.getObjectByName('lava-core');
    if (lavaCore?.userData.glows) {
        const pulse = 1 + Math.sin(time * 1.5) * 0.1;
        const baseScales = [40, 70, 100];
        lavaCore.userData.glows.forEach((sprite, i) => {
            sprite.scale.setScalar(baseScales[i] * pulse);
        });
    }

    // Slow rotation of magma balls
    const elements = group.userData.elements;
    if (elements?.rockClusters) {
        elements.rockClusters.forEach((cluster, i) => {
            cluster.rotation.y += delta * 0.02 * ((i % 2) * 2 - 1);
        });
    }
}

export default {
    config: EARTH_CORE_CONFIG,
    create: createEarthCoreEnvironment,
    update: updateEarthCoreEnvironment,
};

