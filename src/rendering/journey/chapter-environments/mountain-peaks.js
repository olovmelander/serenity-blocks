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
import { getChapterPathRange } from '../path-utils.js';

/**
 * Mountain Peaks environment configuration
 */
export const MOUNTAIN_PEAKS_CONFIG = {
    id: 4,
    name: 'mountain-peaks',
    yStart: 97.5,
    yEnd: 1000,  // Extended much further to keep mountains visible during transition to Ch5
    transitionZone: 0.1,  // Increased transition zone for smoother fade out
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
uniform float uOpacity;
uniform float uAuroraFade;
uniform float uLayerOpacity;

varying vec2 vUv;
varying float vDisplacement;

${noiseGLSL}

void main() {
    // Vertical fade (bottom to top)
    float alpha = smoothstep(0.0, 0.4, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
    
    // Horizontal fade (left to right) - Strong fade to prevent rectangular look
    float xFade = smoothstep(0.0, 0.2, vUv.x) * (1.0 - smoothstep(0.8, 1.0, vUv.x));
    alpha *= xFade;
    
    // Color mixing based on noise and height
    float noiseVal = snoise(vec3(vUv.x * 2.0, vUv.y * 1.0, uTime * 0.1));
    
    vec3 color = mix(uColor1, uColor2, vUv.y);
    color = mix(color, uColor3, smoothstep(0.4, 0.6, noiseVal));
    
    // Add glow bands
    float bands = sin(vUv.y * 20.0 + vDisplacement * 2.0) * 0.5 + 0.5;
    alpha *= 0.5 + bands * 0.5;
    
    // Boost brightness (Reduced from 1.5 to 1.1 for softer look)
    color *= 1.1;
    
    // Final alpha (Reduced from 0.6 to 0.45)
    gl_FragColor = vec4(color, alpha * 0.45 * uLayerOpacity * uAuroraFade * uOpacity);
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
uniform vec3 uSnowColorWarm;
uniform vec3 uRockColorWarm;
uniform vec3 uFogColorWarm;
uniform vec3 uRimColor;
uniform float uRimPower;
uniform float uTransition;
uniform float uOpacity;
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
    vec3 rockColor = mix(uRockColorWarm, uRockColor, uTransition);
    vec3 snowColor = mix(uSnowColorWarm, uSnowColor, uTransition);
    vec3 fogColor = mix(uFogColorWarm, uFogColor, uTransition);
    vec3 rock = rockColor * diff;
    vec3 snow = snowColor * diff;
    
    // Snow pattern
    float snowNoise = fbm(vWorldPosition.xz * 0.05);
    float snowThresh = uSnowLine + snowNoise * 0.2;
    // Slope factor: snow doesn't stick to steep cliffs
    float slope = 1.0 - abs(dot(vNormal, vec3(0.0, 1.0, 0.0)));
    float slopeFactor = smoothstep(0.7, 0.4, slope);
    
    float snowMix = smoothstep(snowThresh - 0.1, snowThresh + 0.1, vHeight);
    snowMix *= slopeFactor;
    
    vec3 color = mix(rock, snow, snowMix);
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    float rim = pow(1.0 - max(dot(vNormal, viewDir), 0.0), uRimPower);
    color += uRimColor * rim * (0.1 + 0.25 * (1.0 - uTransition));
    
    // Fog (Height and Distance based)
    float dist = length(vWorldPosition - cameraPosition);
    float fogFactor = smoothstep(200.0, 600.0, dist);
    
    // Base mist
    float baseMist = smoothstep(0.2, 0.0, vHeight) * 0.8;
    
    color = mix(color, fogColor, max(fogFactor, baseMist));
    
    // BASE FADE: Fade out at low heights to hide the hard edge of the plane
    // vHeight is 0 at base, 1 at peak
    // Fade in from 0.0 to 0.15 height (completely transparent at very base)
    float baseFade = smoothstep(0.0, 0.15, vHeight);
    
    gl_FragColor = vec4(color, uOpacity * baseFade);
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
uniform vec3 topColorDay;
uniform vec3 bottomColorDay;
uniform vec3 topColorNight;
uniform vec3 bottomColorNight;
uniform float offset;
uniform float exponent;
uniform float uTransition;
uniform float uOpacity;
varying vec3 vWorldPosition;
void main() {
    float h = normalize(vWorldPosition + offset).y;
    vec3 topColor = mix(topColorDay, topColorNight, uTransition);
    vec3 bottomColor = mix(bottomColorDay, bottomColorNight, uTransition);
    vec3 color = mix(bottomColor, topColor, max(pow(max(h , 0.0), exponent), 0.0));
    gl_FragColor = vec4(color, uOpacity);
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

    const chapterRange = getChapterPathRange(4);
    const chapter3Range = getChapterPathRange(3);
    const fallbackCenterY = (MOUNTAIN_PEAKS_CONFIG.yStart + MOUNTAIN_PEAKS_CONFIG.yEnd) / 2;
    const chapterCenterY = chapterRange?.center.y ?? fallbackCenterY;
    const chapter3CenterY = chapter3Range?.center.y ?? chapterCenterY;

    if (chapterRange) {
        group.userData.yStart = chapterRange.start.y;
        // Use the MAX of logical end and config end to allow visual extension into next chapter
        group.userData.yEnd = Math.max(chapterRange.end.y, MOUNTAIN_PEAKS_CONFIG.yEnd);
    }

    // 1. High Quality Sky Sphere (Boxiness fix)
    const sky = createSkyBackground(uniforms);
    group.add(sky);
    group.userData.sky = sky;

    // 2. FBM Displacement Mountains (Sakura style)
    // Align with Chapter 3 distant mountains for a seamless transition
    const mountains = new THREE.Group();

    const ch3MountainOffsets = [-10, -20, -30];
    const leftMountainY = chapter3CenterY + ch3MountainOffsets[0];
    const rightMountainY = chapter3CenterY + ch3MountainOffsets[1];
    const centerMountainY = chapter3CenterY + ch3MountainOffsets[2];

    // Left mountain (aligned with Ch3 left mountain)
    const mountain1 = createFBMMountain(uniforms, {
        size: 800,
        height: 300,
        position: new THREE.Vector3(-250, leftMountainY - chapterCenterY, -650),
        seed: 12.34
    });
    mountains.add(mountain1);

    // Right mountain (aligned with Ch3 right mountain)
    const mountain2 = createFBMMountain(uniforms, {
        size: 800,
        height: 280,
        position: new THREE.Vector3(250, rightMountainY - chapterCenterY, -700),
        seed: 45.67
    });
    mountains.add(mountain2);

    // Far center peak (aligned with Ch3 center mountain)
    const mountain3 = createFBMMountain(uniforms, {
        size: 1200,
        height: 500,
        position: new THREE.Vector3(0, centerMountainY - chapterCenterY, -900),
        seed: 89.12
    });
    mountains.add(mountain3);

    group.add(mountains);
    group.userData.mountains = mountains;


    // 3. Shader Aurora Curtains
    const aurora = createAurora(uniforms, 4); // 4 layers
    group.add(aurora);
    group.userData.aurora = aurora;

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
    group.position.y = chapterCenterY;

    return group;
}

function createSkyBackground(uniforms) {
    const vertexShader = skyVertexShader;
    const fragmentShader = skyFragmentShader;
    const uniformsSky = {
        topColorDay: { value: new THREE.Color(0x7ab3ff) },
        bottomColorDay: { value: new THREE.Color(0xbad7ff) },
        topColorNight: { value: new THREE.Color(0x000000) }, // Pure black for seamless space transition
        bottomColorNight: { value: new THREE.Color(0x0a0a14) }, // Match Ch5 background
        offset: { value: 33 },
        exponent: { value: 0.6 },
        uTransition: { value: 0 },
        uOpacity: { value: 1 },
    };

    // Use high segment count to avoid boxy look
    // Increased radius to 6000 to encompass the deep aurora (z=-3000 to -3800)
    const geometry = new THREE.SphereGeometry(6000, 64, 48);
    const material = new THREE.ShaderMaterial({
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
        uniforms: uniformsSky,
        side: THREE.BackSide,
        depthWrite: false,
        transparent: true,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = -100;
    return mesh;
}


function createParticleTexture() {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');

    // Soft circle gradient
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.5)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);

    const texture = new THREE.CanvasTexture(canvas);
    return texture;
}

function createStars(uniforms, count) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = 250 + Math.random() * 50;

        if (Math.cos(phi) < 0) continue;

        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.cos(phi);
        positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
        sizes[i] = 0.5 + Math.random() * 1.5;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // Use texture map for round particles
    const texture = createParticleTexture();
    const material = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 2.0, // Slightly larger to account for texture fade
        map: texture,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        sizeAttenuation: true,
        bgPlane: false // Custom flag if needed
    });

    return new THREE.Points(geometry, material);
}

// ... createFBMMountain ... (UNCHANGED, skipping for brevity in replacement if possible, but I must replace the block containing createStars to link it properly. I will replace createStars and add the helper before it)

// Actually, I can just append the helper and update the functions separately or in one large block.
// I'll update createStars first.


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
            uSnowColor: { value: new THREE.Color(0xdceef5) }, // Darkened from pure white to prevent blowout
            uSnowColorWarm: { value: new THREE.Color(0xe0e6ee) },
            uRockColor: { value: new THREE.Color(0x3a4555) },
            uRockColorWarm: { value: new THREE.Color(0x556577) },
            uFogColor: { value: new THREE.Color(0x1a2a3a) },
            uFogColorWarm: { value: new THREE.Color(0x7fa0c2) },
            uSnowLine: { value: 0.4 },
            uRimColor: { value: new THREE.Color(0x88bbff) }, // Reduced intensity
            uRimPower: { value: 3.5 }, // Increased power for tighter/smaller rim
            uTransition: { value: 0 },
            uOpacity: { value: 1 },
        },
        vertexShader: mountainVertexShader,
        fragmentShader: mountainFragmentShader,
        transparent: true,
        depthWrite: false,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(config.position);
    return mesh;
}

/**
 * Creates a soft, muted snowy terrain
 * Positioned to match Chapter 3 ground level for seamless transition
 * Uses softer colors to prevent glowing/brightness issues
 */
function createSnowFloor(uniforms, offsetY = -123.75) {
    const group = new THREE.Group();
    group.name = 'snow-floor';

    // Use circular geometry to completely eliminate straight edges
    const radius = 3000;
    const segments = 128;
    const geometry = new THREE.CircleGeometry(radius, segments);
    geometry.rotateX(-Math.PI / 2);

    const positionAttr = geometry.attributes.position;

    // Simple noise for subtle snow variation
    const noise = (x, z, scale) => {
        return Math.sin(x * scale) * Math.cos(z * scale * 0.8) * 0.5 +
            Math.sin(x * scale * 2.3) * Math.cos(z * scale * 1.7) * 0.25;
    };

    // Apply gentle height displacement
    for (let i = 0; i < positionAttr.count; i++) {
        const x = positionAttr.getX(i);
        const z = positionAttr.getZ(i);

        // Very gentle snow drifts
        const height = noise(x, z, 0.01) * 8 + noise(x, z, 0.025) * 3;
        positionAttr.setY(i, height);
    }

    geometry.computeVertexNormals();

    // Muted snow material - softer colors to prevent glowing
    const snowMaterial = new THREE.ShaderMaterial({
        uniforms: {
            uSnowColor: { value: new THREE.Color(0xdde4ea) },      // Muted snow white (not pure white)
            uShadowColor: { value: new THREE.Color(0x8a9aa8) },    // Soft blue-gray shadows
            uLightDir: { value: new THREE.Vector3(0.3, 0.8, 0.5).normalize() },
            uTime: uniforms.uTime,
            uOpacity: { value: 1 },
        },
        vertexShader: `
            varying vec3 vNormal;
            varying vec3 vPosition;
            varying vec2 vUv;

            void main() {
                vNormal = normalize(normalMatrix * normal);
                vPosition = position;
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 uSnowColor;
            uniform vec3 uShadowColor;
            uniform vec3 uLightDir;
            uniform float uTime;
            uniform float uOpacity;

            varying vec3 vNormal;
            varying vec3 vPosition;
            varying vec2 vUv;

            float rand(vec2 n) {
                return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453);
            }

            float noise(vec2 p) {
                vec2 ip = floor(p);
                vec2 u = fract(p);
                u = u * u * (3.0 - 2.0 * u);
                float res = mix(
                    mix(rand(ip), rand(ip + vec2(1.0, 0.0)), u.x),
                    mix(rand(ip + vec2(0.0, 1.0)), rand(ip + vec2(1.0, 1.0)), u.x), u.y);
                return res;
            }

            void main() {
                // Soft lighting with more ambient
                float NdotL = dot(vNormal, uLightDir);
                float light = 0.6 + 0.4 * NdotL;

                // Muted snow with soft shadows
                vec3 color = mix(uShadowColor, uSnowColor, light);

                // Distance fade to sky/atmosphere color
                float dist = length(vPosition.xz);
                float distFactor = 1.0 - smoothstep(600.0, 1400.0, dist) * 0.3;
                color *= distFactor;

                // Blend to atmosphere at far distance
                vec3 atmColor = vec3(0.1, 0.15, 0.22);
                color = mix(color, atmColor, smoothstep(1000.0, 1800.0, dist));

                float sparkle = smoothstep(0.9, 1.0, noise(vPosition.xz * 0.2 + uTime * 0.02));
                color += sparkle * 0.1;

                // Radial falloff based on world position distance
                // Use world XZ distance from center for smooth circular fade
                float distFromCenter = length(vPosition.xz);
                
                // Add noise to create organic, irregular edge
                float edgeNoise = noise(vPosition.xz * 0.005) * 400.0;
                float adjustedDist = distFromCenter + edgeNoise;
                
                // Fade from 2000 (solid) to 2800 (fully transparent)
                // This ensures edges are completely invisible before reaching geometry boundary
                float alpha = 1.0 - smoothstep(2000.0, 2800.0, adjustedDist);
                
                gl_FragColor = vec4(color, uOpacity * alpha);
            }
        `,
        side: THREE.FrontSide, // Ensure we see it from above
        depthWrite: false,
        depthTest: true,
        transparent: true,
    });

    const mesh = new THREE.Mesh(geometry, snowMaterial);
    // Position aligned with Ch3 ground level (Ch3 ground at local y=-15, world y=60)
    // Ch4 local y = 60 - 183.75 = -123.75
    mesh.position.set(0, offsetY, -900);
    mesh.renderOrder = -1;
    group.add(mesh);

    return group;
}

function createAurora(uniforms, layers) {
    const group = new THREE.Group();

    // Aurora configurations for each layer
    // Positioned BEHIND mountains (approx z=-900) and HIGHER up
    const auroraConfigs = [
        // Main central aurora - Far behind center peak (z=-900), positioned HIGH
        { x: 0, y: 1600, z: -3000, width: 5000, height: 1500, rotY: 0, opacity: 1.0 },
        // Left aurora curtain - Behind left mountain (z=-650), positioned HIGH
        { x: -500, y: 1500, z: -2800, width: 3000, height: 1200, rotY: 0.1, opacity: 0.8 },
        // Right aurora curtain - Behind right mountain (z=-700), positioned HIGH
        { x: 500, y: 1550, z: -2850, width: 3000, height: 1200, rotY: -0.1, opacity: 0.8 },
        // Far back aurora - Creates depth, positioned HIGHEST
        { x: 0, y: 1800, z: -3800, width: 6000, height: 1800, rotY: 0, opacity: 0.6 },
    ];

    for (let i = 0; i < Math.min(layers, auroraConfigs.length); i++) {
        const config = auroraConfigs[i];
        const geometry = new THREE.PlaneGeometry(config.width, config.height, 64, 16);

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: uniforms.uTime,
                layerOffset: { value: i * 2.0 },
                uColor1: { value: new THREE.Color(0x00ffaa) }, // Green
                uColor2: { value: new THREE.Color(0x00aaff) }, // Cyan
                uColor3: { value: new THREE.Color(0xaa00ff) }, // Purple
                uOpacity: { value: 1 },
                uAuroraFade: { value: 0 },
                uLayerOpacity: { value: config.opacity },
            },
            vertexShader: auroraVertexShader,
            fragmentShader: auroraFragmentShader,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        const curtain = new THREE.Mesh(geometry, material);
        curtain.position.set(config.x, config.y, config.z);
        curtain.rotation.y = config.rotY;
        curtain.renderOrder = -50; // Ensure it renders behind mountains (0) but in front of sky (-100)
        group.add(curtain);
    }

    return group;
}

function createSnow(uniforms, count) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 200;
        positions[i * 3 + 1] = Math.random() * 100;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 100;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // Reuse texture
    const texture = createParticleTexture();

    const material = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.8,
        map: texture,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        sizeAttenuation: true
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

export function updateMountainPeaksEnvironment(group, delta, time, camera) {
    const uniforms = group.userData.uniforms;
    if (uniforms?.uTime) {
        uniforms.uTime.value = time;
    }

    const cameraY = camera?.position?.y ?? group.position.y;
    const yStart = group.userData.yStart ?? MOUNTAIN_PEAKS_CONFIG.yStart;
    const yEnd = group.userData.yEnd ?? MOUNTAIN_PEAKS_CONFIG.yEnd;
    const progress = yEnd > yStart
        ? THREE.MathUtils.clamp((cameraY - yStart) / (yEnd - yStart), 0, 1)
        : 0;

    // Calculate progress (already exists above)
    // const progress = ...

    // ACCELERATED TRANSITIONS due to extended yEnd (1000)
    // Make sky turn dark INSTANTLY (fully night by 10% progress)
    const transition = THREE.MathUtils.smoothstep(progress, 0.0, 0.1);
    // Make aurora appear INSTANTLY (fully visible by 15% progress)
    const auroraFade = THREE.MathUtils.smoothstep(progress, 0.0, 0.15);

    // SCALING: Mountains shrink as camera ascends into space (starts at 60% progress)
    // At 60% progress: scale = 1.0 (full size)
    // At 100% progress: scale = 0.3 (shrunk down as if drifting away)
    const scaleProgress = THREE.MathUtils.smoothstep(progress, 0.6, 1.0);
    const mountainScale = THREE.MathUtils.lerp(1.0, 0.3, scaleProgress);

    // Apply scale to entire environment group (mountains, aurora, snow floor)
    // But NOT to sky (it should stay full size)
    const mountains = group.userData.mountains;
    if (mountains) {
        mountains.scale.setScalar(mountainScale);
        // Also move mountains down slightly as they shrink to enhance "flying away" effect
        mountains.position.y = -scaleProgress * 50;
    }

    const aurora = group.userData.aurora;
    if (aurora) {
        aurora.scale.setScalar(mountainScale);
        aurora.position.y = -scaleProgress * 30;
    }

    const snowFloor = group.userData.snowFloor;
    if (snowFloor) {
        snowFloor.scale.setScalar(mountainScale);
        snowFloor.position.y = -scaleProgress * 50;
    }

    // EXIT FADE: Very late fade out (from 90% to 100%)
    // This ensures mountains are visible for a long time while shrinking
    const exitFade = 1.0 - THREE.MathUtils.smoothstep(progress, 0.90, 1.0);

    const sky = group.userData.sky;
    if (sky?.material?.uniforms) {
        if (sky.material.uniforms.uTransition) sky.material.uniforms.uTransition.value = transition;
        if (sky.material.uniforms.uOpacity) sky.material.uniforms.uOpacity.value = exitFade;
    }

    // Apply transition/opacity to mountains (already have reference from scaling)
    if (mountains) {
        mountains.traverse((child) => {
            if (child.material?.uniforms) {
                if (child.material.uniforms.uTransition) child.material.uniforms.uTransition.value = transition;
                if (child.material.uniforms.uOpacity) child.material.uniforms.uOpacity.value = exitFade;
            }
        });
    }

    // Apply opacity to snow floor (already have reference from scaling)
    if (snowFloor?.material?.uniforms?.uOpacity) {
        snowFloor.material.uniforms.uOpacity.value = exitFade;
    }

    // Apply aurora fade and opacity (already have reference from scaling)
    if (aurora) {
        aurora.traverse((child) => {
            if (child.material?.uniforms) {
                if (child.material.uniforms.uAuroraFade) child.material.uniforms.uAuroraFade.value = auroraFade;
                if (child.material.uniforms.uOpacity) child.material.uniforms.uOpacity.value = exitFade;
            }
        });
    }

    // Update Snow
    const snow = group.children.find(c => c.type === 'Points' && c.userData.velocities);
    if (snow) {
        // Apply exit fade to snow particles
        if (snow.material) snow.material.opacity = 0.8 * exitFade;

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

    // Update Stars (Exit fade)
    // Find stars by assumption (no velocities) or name? 
    // Usually standard stars, let's just traverse or find Points without velocity
    // Or easier:
    const stars = group.children.find(c => c.type === 'Points' && !c.userData.velocities);
    if (stars && stars.material) {
        stars.material.opacity = 0.8 * exitFade;
    }
}

export default {
    config: MOUNTAIN_PEAKS_CONFIG,
    create: createMountainPeaksEnvironment,
    update: updateMountainPeaksEnvironment,
};
