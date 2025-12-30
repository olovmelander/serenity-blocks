/**
 * @fileoverview Mountain Peaks Environment - Chapter 4 Visual Theme
 * 
 * Enhanced Version:
 * - High-quality FBM Displacement Mountains (Sakura-style)
 * - Shader-based 3D Aurora Borealis (Aurora-theme style)
 * - Smooth Spherical Background
 * - Falling Snow Particles
 */

import * as THREE from 'three';

/**
 * Mountain Peaks environment configuration
 */
export const MOUNTAIN_PEAKS_CONFIG = {
    id: 4,
    name: 'mountain-peaks',
    yStart: 65,
    yEnd: 95,
    colors: {
        primary: 0x2d3436,
        secondary: 0x636e72,
        tertiary: 0xaaffdd, // Aurora green
        accent: 0x74b9ff,
        background: 0x090a0f,
    },
};

// ═══════════════════════════════════════════════════════════════════════════════
// GLSL SHARED NOISE
// ═══════════════════════════════════════════════════════════════════════════════

const noiseGLSL = `
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
`;

// ═══════════════════════════════════════════════════════════════════════════════
// AURORA SHADERS
// ═══════════════════════════════════════════════════════════════════════════════

const auroraVertexShader = `
uniform float uTime;
uniform float layerOffset;

varying vec2 vUv;
varying float vDisplacement;

${noiseGLSL}

void main() {
    vUv = uv;
    
    // Wave animation
    float t = uTime * 0.2 + layerOffset;
    
    // Multiple noise octaves for organic movement
    float noise1 = snoise(vec3(position.x * 0.05, position.y * 0.05, t * 0.5));
    float noise2 = snoise(vec3(position.x * 0.1, position.y * 0.1, t * 0.8)) * 0.5;
    
    vDisplacement = noise1 + noise2;
    
    vec3 transformed = position;
    // Add z displacement for waving curtain effect
    transformed.z += vDisplacement * 10.0;
    // Slight x sway
    transformed.x += sin(position.y * 0.05 + t) * 5.0;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
}
`;

const auroraFragmentShader = `
uniform float uTime;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;

varying vec2 vUv;
varying float vDisplacement;

${noiseGLSL}

void main() {
    // Vertical fade (bottom to top)
    float alpha = smoothstep(0.0, 0.2, vUv.y) * (1.0 - smoothstep(0.8, 1.0, vUv.y));
    
    // Color mixing based on noise and height
    float noiseVal = snoise(vec3(vUv.x * 2.0, vUv.y * 1.0, uTime * 0.1));
    
    vec3 color = mix(uColor1, uColor2, vUv.y);
    color = mix(color, uColor3, smoothstep(0.4, 0.6, noiseVal));
    
    // Add glow bands
    float bands = sin(vUv.y * 20.0 + vDisplacement * 2.0) * 0.5 + 0.5;
    alpha *= 0.5 + bands * 0.5;
    
    // Boost brightness
    color *= 1.5;
    
    gl_FragColor = vec4(color, alpha * 0.6);
}
`;

// ═══════════════════════════════════════════════════════════════════════════════
// MOUNTAIN SHADERS
// ═══════════════════════════════════════════════════════════════════════════════

const mountainVertexShader = `
attribute float aHeight;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying float vHeight;
varying vec2 vUv;

void main() {
    vNormal = normalize(normalMatrix * normal);
    vUv = uv;
    vHeight = aHeight;
    
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const mountainFragmentShader = `
uniform vec3 uSnowColor;
uniform vec3 uRockColor;
uniform vec3 uFogColor;
uniform float uSnowLine;

varying vec3 vNormal;
varying vec3 vWorldPosition;
varying float vHeight;
varying vec2 vUv; // Use vUv here

// Hash noise
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// 2D Noise
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

// FBM
float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
        v += a * noise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

void main() {
    // Lighting
    vec3 lightDir = normalize(vec3(0.5, 0.8, 0.5));
    float diff = max(0.3, dot(vNormal, lightDir));
    
    // Colors
    vec3 rock = uRockColor * diff;
    vec3 snow = uSnowColor * diff;
    
    // Snow pattern
    float snowNoise = fbm(vWorldPosition.xz * 0.05);
    float snowThresh = uSnowLine + snowNoise * 0.2;
    // Slope factor: snow doesn't stick to steep cliffs
    float slope = 1.0 - abs(dot(vNormal, vec3(0.0, 1.0, 0.0)));
    float slopeFactor = smoothstep(0.7, 0.4, slope);
    
    float snowMix = smoothstep(snowThresh - 0.1, snowThresh + 0.1, vHeight);
    snowMix *= slopeFactor;
    
    vec3 color = mix(rock, snow, snowMix);
    
    // Fog (Height and Distance based)
    float dist = length(vWorldPosition - cameraPosition);
    float fogFactor = smoothstep(200.0, 600.0, dist);
    
    // Base mist
    float baseMist = smoothstep(0.2, 0.0, vHeight) * 0.8;
    
    color = mix(color, uFogColor, max(fogFactor, baseMist));
    
    gl_FragColor = vec4(color, 1.0);
}
`;

// ═══════════════════════════════════════════════════════════════════════════════
// BACKGROUND SHADERS
// ═══════════════════════════════════════════════════════════════════════════════

const skyVertexShader = `
varying vec3 vWorldPosition;
void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const skyFragmentShader = `
uniform vec3 topColor;
uniform vec3 bottomColor;
uniform float offset;
uniform float exponent;
varying vec3 vWorldPosition;
void main() {
    float h = normalize(vWorldPosition + offset).y;
    gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h , 0.0), exponent), 0.0)), 1.0);
}
`;

// ═══════════════════════════════════════════════════════════════════════════════
// ENVIRONMENT CREATION
// ═══════════════════════════════════════════════════════════════════════════════

export function createMountainPeaksEnvironment(options = {}) {
    const group = new THREE.Group();
    group.name = 'mountain-peaks-environment';
    group.userData.chapterId = 4;
    group.userData.yStart = MOUNTAIN_PEAKS_CONFIG.yStart;
    group.userData.yEnd = MOUNTAIN_PEAKS_CONFIG.yEnd;

    const uniforms = { uTime: { value: 0 } };
    group.userData.uniforms = uniforms;

    // 1. High Quality Sky Sphere (Boxiness fix)
    const sky = createSkyBackground(uniforms);
    group.add(sky);

    // 2. FBM Displacement Mountains (Sakura style)
    // Create 3 overlapping mountains for a range effect
    const mountains = new THREE.Group();

    // Left mountain
    const mountain1 = createFBMMountain(uniforms, {
        size: 500,
        height: 200,
        position: new THREE.Vector3(-150, -60, -250),
        seed: 12.34
    });
    mountains.add(mountain1);

    // Right mountain
    const mountain2 = createFBMMountain(uniforms, {
        size: 500,
        height: 180,
        position: new THREE.Vector3(150, -70, -300),
        seed: 45.67
    });
    mountains.add(mountain2);

    // Far center peak
    const mountain3 = createFBMMountain(uniforms, {
        size: 700,
        height: 300,
        position: new THREE.Vector3(0, -80, -400),
        seed: 89.12
    });
    mountains.add(mountain3);

    group.add(mountains);

    // 3. Shader Aurora Curtains
    const aurora = createAurora(uniforms, 4); // 4 layers
    group.add(aurora);

    // 4. Falling Snow
    const snow = createSnow(uniforms, options.particleCount || 1000);
    group.add(snow);

    // 5. Stars
    const stars = createStars(uniforms, 1000);
    group.add(stars);

    // Lighting
    const ambient = new THREE.AmbientLight(0x445566, 0.4);
    group.add(ambient);

    const moonLight = new THREE.DirectionalLight(0xaaddff, 0.5);
    moonLight.position.set(50, 100, 50);
    group.add(moonLight);

    // Vertical positioning
    group.position.y = (MOUNTAIN_PEAKS_CONFIG.yStart + MOUNTAIN_PEAKS_CONFIG.yEnd) / 2;

    return group;
}

function createSkyBackground(uniforms) {
    const vertexShader = skyVertexShader;
    const fragmentShader = skyFragmentShader;
    const uniformsSky = {
        topColor: { value: new THREE.Color(0x000510) },    // Deep space
        bottomColor: { value: new THREE.Color(0x1a2a3a) }, // Twilight horizon
        offset: { value: 33 },
        exponent: { value: 0.6 }
    };

    // Use high segment count to avoid boxy look
    const geometry = new THREE.SphereGeometry(400, 64, 48);
    const material = new THREE.ShaderMaterial({
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
        uniforms: uniformsSky,
        side: THREE.BackSide,
        depthWrite: false,
    });

    return new THREE.Mesh(geometry, material);
}

function createStars(uniforms, count) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = 250 + Math.random() * 50;

        // Only upper hemisphere
        if (Math.cos(phi) < 0) continue;

        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.cos(phi);
        positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
        sizes[i] = 0.5 + Math.random() * 1.5;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 1.5,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.8
    });

    return new THREE.Points(geometry, material);
}

/**
 * Creates a mountain using PlaneGeometry and heightmap displacement
 * (Adapted from SakuraTwilightTheme)
 */
function createFBMMountain(uniforms, config) {
    const segments = 128;
    const geometry = new THREE.PlaneGeometry(config.size, config.size, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    // --- FBM Noise Generation ---
    const posAttribute = geometry.attributes.position;
    const vertex = new THREE.Vector3();
    const heights = [];
    const seed = config.seed || 0;

    // Helper functions for FBM on CPU
    const fract = (n) => n - Math.floor(n);
    const mix = (a, b, t) => a * (1 - t) + b * t;

    // Simple pseudo-random based on position + seed
    const rand = (x, y) => {
        return Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453;
    };

    const noise = (x, y) => {
        const i = Math.floor(x);
        const j = Math.floor(y);
        const f = fract(x);
        const g = fract(y);

        // Cubic smoothstep
        const u = f * f * (3.0 - 2.0 * f);
        const v = g * g * (3.0 - 2.0 * g);

        return mix(mix(fract(rand(i, j)), fract(rand(i + 1, j)), u),
            mix(fract(rand(i, j + 1)), fract(rand(i + 1, j + 1)), u), v);
    };

    const fbm = (x, y) => {
        let v = 0.0;
        let a = 0.5;
        for (let i = 0; i < 5; i++) {
            v += a * noise(x, y);
            x *= 2.0;
            y *= 2.0;
            a *= 0.5;
        }
        return v;
    };



    // Apply displacement
    const center = new THREE.Vector2(0, 0);
    for (let i = 0; i < posAttribute.count; i++) {
        vertex.fromBufferAttribute(posAttribute, i);

        // Distance falloff (create a peak)
        const dx = vertex.x;
        const dz = vertex.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const maxDist = config.size * 0.45;

        if (dist > maxDist) {
            posAttribute.setY(i, 0);
            heights.push(0);
            continue;
        }

        // Cone shape
        const normDist = dist / maxDist;
        const cone = Math.pow(1.0 - normDist, 1.5) * config.height;

        // Noise detail
        const n = fbm(vertex.x * 0.01, vertex.z * 0.01);
        const n2 = fbm(vertex.x * 0.04, vertex.z * 0.04);

        const detail = (n * 0.7 + n2 * 0.3) * config.height * 0.4 * (1.0 - normDist);

        const h = cone + detail;
        posAttribute.setY(i, h);
        heights.push(h);
    }

    geometry.computeVertexNormals();

    // Height attribute for shader
    const heightAttr = new Float32Array(posAttribute.count);
    for (let i = 0; i < posAttribute.count; i++) {
        heightAttr[i] = heights[i] / config.height;
    }
    geometry.setAttribute('aHeight', new THREE.BufferAttribute(heightAttr, 1));

    const material = new THREE.ShaderMaterial({
        uniforms: {
            uSnowColor: { value: new THREE.Color(0xffffff) },
            uRockColor: { value: new THREE.Color(0x3a4555) },
            uFogColor: { value: new THREE.Color(0x1a2a3a) },
            uSnowLine: { value: 0.4 },
        },
        vertexShader: mountainVertexShader,
        fragmentShader: mountainFragmentShader,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(config.position);
    return mesh;
}

function createAurora(uniforms, layers) {
    const group = new THREE.Group();

    for (let i = 0; i < layers; i++) {
        // Curved plane for curtain
        // Using PlaneGeometry but we'll displace it in shader
        const geometry = new THREE.PlaneGeometry(300, 60, 64, 16);

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: uniforms.uTime,
                layerOffset: { value: i * 2.0 },
                uColor1: { value: new THREE.Color(0x00ffaa) }, // Green
                uColor2: { value: new THREE.Color(0x00aaff) }, // Cyan
                uColor3: { value: new THREE.Color(0xaa00ff) }, // Purple
            },
            vertexShader: auroraVertexShader,
            fragmentShader: auroraFragmentShader,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        const curtain = new THREE.Mesh(geometry, material);
        curtain.position.set(0, 40 + i * 5, -150 - i * 30);
        curtain.rotation.y = Math.PI * 0.1 * (i % 2 === 0 ? 1 : -1);
        group.add(curtain);
    }

    return group;
}

function createSnow(uniforms, count) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3); // Store velocity in unused attrib or just compute in shader?
    // For simple update loop:

    for (let i = 0; i < count; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 200;
        positions[i * 3 + 1] = Math.random() * 100;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 100;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.8,
        transparent: true,
        opacity: 0.6,
    });

    const snow = new THREE.Points(geometry, material);
    snow.userData = {
        velocities: Array(count).fill(0).map(() => ({
            y: -0.1 - Math.random() * 0.2,
            x: (Math.random() - 0.5) * 0.05,
            z: (Math.random() - 0.5) * 0.05
        }))
    };

    return snow;
}

export function updateMountainPeaksEnvironment(group, delta, time) {
    const uniforms = group.userData.uniforms;
    if (uniforms?.uTime) {
        uniforms.uTime.value = time;
    }

    // Update Snow
    const snow = group.children.find(c => c.type === 'Points' && c.userData.velocities);
    if (snow) {
        const positions = snow.geometry.attributes.position.array;
        const vels = snow.userData.velocities;

        for (let i = 0; i < vels.length; i++) {
            positions[i * 3] += vels[i].x;
            positions[i * 3 + 1] += vels[i].y;
            positions[i * 3 + 2] += vels[i].z;

            // Loop height
            if (positions[i * 3 + 1] < -10) {
                positions[i * 3 + 1] = 100;
            }
        }
        snow.geometry.attributes.position.needsUpdate = true;
    }
}

export default {
    config: MOUNTAIN_PEAKS_CONFIG,
    create: createMountainPeaksEnvironment,
    update: updateMountainPeaksEnvironment,
};
