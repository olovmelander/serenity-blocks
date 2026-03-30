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
import {
    getActiveOdysseyChapterPositions,
    getChapterPathRange,
} from '../path-utils.js';
import { createMountainAuroraBackdrop } from './shared/mountain-aurora.js';

/**
 * Mountain Peaks environment configuration
 */
export const MOUNTAIN_PEAKS_CONFIG = {
    id: 4,
    name: 'mountain-peaks',
    yStart: 97.5,
    yEnd: 900,
    transitionZone: 0.1, // Increased transition zone for smoother fade out
    colors: {
        primary: 0x2d3436,
        secondary: 0x636e72,
        tertiary: 0xaaffdd, // Aurora green
        accent: 0x74b9ff,
        background: 0x090a0f,
    },
};

const MOUNTAIN_TRANSITION_START = 0.08;
const MOUNTAIN_TRANSITION_END = 0.28;
const MAIN_PEAK_MATERIAL_PROFILE = Object.freeze({
    snowColor: 0xc7d6e0,
    snowColorWarm: 0xbfc9d3,
    rockColor: 0x465463,
    rockColorWarm: 0x667789,
    fogColor: 0x314252,
    fogColorWarm: 0x91adc2,
    snowLine: 0.5,
    rimColor: 0x5f8098,
    rimPower: 4.8,
    baseMistStrength: 0.45,
    baseFadeStart: 0.02,
    baseFadeEnd: 0.1,
});
const FOOTHILL_APRON_MATERIAL_PROFILE = Object.freeze({
    snowColor: 0xbcc8d1,
    snowColorWarm: 0xb3bec7,
    rockColor: 0x56626d,
    rockColorWarm: 0x746c64,
    fogColor: 0x4f6271,
    fogColorWarm: 0xa8bdca,
    snowLine: 0.7,
    rimColor: 0x5f8098,
    rimPower: 4.8,
    baseMistStrength: 0.22,
    baseFadeStart: 0.08,
    baseFadeEnd: 0.22,
});

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
uniform float uBaseMistStrength;
uniform float uBaseFadeStart;
uniform float uBaseFadeEnd;

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
    color += uRimColor * rim * (0.03 + 0.09 * (1.0 - uTransition));
    
    // Fog (Height and Distance based)
    float dist = length(vWorldPosition - cameraPosition);
    float fogFactor = smoothstep(200.0, 600.0, dist);
    
    // Base mist
    float baseMist = smoothstep(0.2, 0.0, vHeight) * uBaseMistStrength;
    
    color = mix(color, fogColor, max(fogFactor, baseMist));
    
    // BASE FADE: Fade out at low heights to hide the hard edge of the plane
    // vHeight is 0 at base, 1 at peak
    // Fade in from the tuned range so foothills stay grounded.
    float baseFade = smoothstep(uBaseFadeStart, uBaseFadeEnd, vHeight);
    
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

function collectUniformTargets(root, uniformName) {
    if (!root) return [];

    const targets = [];
    const seen = new Set();

    const collectFromMaterial = (material) => {
        const uniform = material?.uniforms?.[uniformName];
        if (!uniform || seen.has(uniform)) return;
        if (typeof uniform.value !== 'number') return;

        if (uniform.__odysseyBaseOpacity === undefined && uniformName === 'uOpacity') {
            uniform.__odysseyBaseOpacity = uniform.value;
        }

        seen.add(uniform);
        targets.push(uniform);
    };

    root.traverse((child) => {
        if (!child.material) return;
        if (Array.isArray(child.material)) {
            child.material.forEach(collectFromMaterial);
        } else {
            collectFromMaterial(child.material);
        }
    });

    return targets;
}

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
    const progressWindow = getMountainChapterProgressWindow();
    group.userData.progressStart = progressWindow.start;
    group.userData.progressEnd = progressWindow.end;

    // 1. High Quality Sky Sphere (Boxiness fix)
    const sky = createSkyBackground();
    group.add(sky);
    group.userData.sky = sky;

    // 2. FBM foothills + mountains (aligned to Chapter 3 distant terrain)
    const massif = new THREE.Group();
    massif.name = 'mountain-massif';

    const chapter4StartY = chapterRange?.start.y ?? chapterCenterY;
    const foothillBaseY = (chapter4StartY - chapterCenterY) - 74;
    const foothillApron = createFoothillApron(uniforms, foothillBaseY);
    massif.add(foothillApron);
    group.userData.foothillApron = foothillApron;

    const mountains = new THREE.Group();
    mountains.name = 'main-peaks';

    const ch3MountainOffsets = [-10, -20, -30];
    const leftMountainY = chapter3CenterY + ch3MountainOffsets[0];
    const rightMountainY = chapter3CenterY + ch3MountainOffsets[1];
    const centerMountainY = chapter3CenterY + ch3MountainOffsets[2];

    // Left mountain (aligned with Ch3 left mountain)
    const mountain1 = createFBMMountain(uniforms, {
        size: 800,
        height: 300,
        position: new THREE.Vector3(-250, leftMountainY - chapterCenterY, -650),
        seed: 12.34,
        materialProfile: MAIN_PEAK_MATERIAL_PROFILE,
    });
    mountains.add(mountain1);

    // Right mountain (aligned with Ch3 right mountain)
    const mountain2 = createFBMMountain(uniforms, {
        size: 800,
        height: 280,
        position: new THREE.Vector3(250, rightMountainY - chapterCenterY, -700),
        seed: 45.67,
        materialProfile: MAIN_PEAK_MATERIAL_PROFILE,
    });
    mountains.add(mountain2);

    // Far center peak (aligned with Ch3 center mountain)
    const mountain3 = createFBMMountain(uniforms, {
        size: 1200,
        height: 500,
        position: new THREE.Vector3(0, centerMountainY - chapterCenterY, -900),
        seed: 89.12,
        materialProfile: MAIN_PEAK_MATERIAL_PROFILE,
    });
    mountains.add(mountain3);

    massif.add(mountains);
    group.add(massif);
    group.userData.mountains = massif;
    group.userData.mainPeaks = mountains;

    // 3. Shader Aurora Curtains
    const aurora = createMountainAuroraBackdrop(uniforms, {
        name: 'mountain-aurora',
    });
    group.add(aurora);
    group.userData.aurora = aurora;
    group.userData.mountainTransitionUniformTargets = collectUniformTargets(massif, 'uTransition');
    group.userData.mountainOpacityUniformTargets = collectUniformTargets(massif, 'uOpacity');
    group.userData.auroraFadeUniformTargets = collectUniformTargets(aurora, 'uAuroraFade');
    group.userData.auroraOpacityUniformTargets = collectUniformTargets(aurora, 'uOpacity');

    // 4. Falling Snow
    const snow = createSnow(uniforms, options.particleCount || 1000);
    group.add(snow);
    group.userData.snow = snow;

    // 5. Stars
    const stars = createStars(uniforms, 1000);
    group.add(stars);
    group.userData.stars = stars;

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

function createSkyBackground() {
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
        vertexShader,
        fragmentShader,
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
    });

    return new THREE.Points(geometry, material);
}

/**
 * Creates a mountain using PlaneGeometry and heightmap displacement
 * (Adapted from SakuraTwilightTheme)
 */
function createFBMMountain(uniforms, config) {
    const {
        materialProfile = MAIN_PEAK_MATERIAL_PROFILE,
    } = config;
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
    const rand = (x, y) => Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453;

    const noise = (x, y) => {
        const i = Math.floor(x);
        const j = Math.floor(y);
        const f = fract(x);
        const g = fract(y);

        // Cubic smoothstep
        const u = f * f * (3.0 - 2.0 * f);
        const v = g * g * (3.0 - 2.0 * g);

        return mix(
            mix(fract(rand(i, j)), fract(rand(i + 1, j)), u),
            mix(fract(rand(i, j + 1)), fract(rand(i + 1, j + 1)), u),
            v,
        );
    };

    const fbm = (x, y) => {
        let sampleX = x;
        let sampleY = y;
        let v = 0.0;
        let a = 0.5;
        for (let i = 0; i < 5; i++) {
            v += a * noise(sampleX, sampleY);
            sampleX *= 2.0;
            sampleY *= 2.0;
            a *= 0.5;
        }
        return v;
    };

    // Apply displacement
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
        const cone = (1.0 - normDist) ** 1.5 * config.height;

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
            uSnowColor: { value: new THREE.Color(materialProfile.snowColor) },
            uSnowColorWarm: { value: new THREE.Color(materialProfile.snowColorWarm) },
            uRockColor: { value: new THREE.Color(materialProfile.rockColor) },
            uRockColorWarm: { value: new THREE.Color(materialProfile.rockColorWarm) },
            uFogColor: { value: new THREE.Color(materialProfile.fogColor) },
            uFogColorWarm: { value: new THREE.Color(materialProfile.fogColorWarm) },
            uSnowLine: { value: materialProfile.snowLine },
            uRimColor: { value: new THREE.Color(materialProfile.rimColor) },
            uRimPower: { value: materialProfile.rimPower },
            uBaseMistStrength: { value: materialProfile.baseMistStrength },
            uBaseFadeStart: { value: materialProfile.baseFadeStart },
            uBaseFadeEnd: { value: materialProfile.baseFadeEnd },
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

function createFoothillApron(uniforms, baseY) {
    const group = new THREE.Group();
    group.name = 'foothill-apron';

    [
        {
            size: 1100,
            height: 72,
            position: new THREE.Vector3(-330, baseY - 12, -600),
            seed: 21.17,
        },
        {
            size: 1250,
            height: 92,
            position: new THREE.Vector3(30, baseY - 20, -860),
            seed: 33.71,
        },
        {
            size: 1100,
            height: 78,
            position: new THREE.Vector3(330, baseY - 10, -710),
            seed: 58.42,
        },
    ].forEach((config) => {
        const foothill = createFBMMountain(uniforms, {
            ...config,
            materialProfile: FOOTHILL_APRON_MATERIAL_PROFILE,
        });
        foothill.renderOrder = -2;
        group.add(foothill);
    });

    return group;
}

/**
 * Creates a soft, muted snowy terrain
 * Positioned to match Chapter 3 ground level for seamless transition
 * Uses softer colors to prevent glowing/brightness issues
 */
export function createSnowFloor(uniforms, offsetY = -123.75) {
    const group = new THREE.Group();
    group.name = 'snow-floor';

    // Use circular geometry to completely eliminate straight edges
    const radius = 3000;
    const segments = 128;
    const geometry = new THREE.CircleGeometry(radius, segments);
    geometry.rotateX(-Math.PI / 2);

    const positionAttr = geometry.attributes.position;

    // Simple noise for subtle snow variation
    const noise = (x, z, scale) => Math.sin(x * scale) * Math.cos(z * scale * 0.8) * 0.5
        + Math.sin(x * scale * 2.3) * Math.cos(z * scale * 1.7) * 0.25;

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
            uSnowColor: { value: new THREE.Color(0xdde4ea) }, // Muted snow white (not pure white)
            uShadowColor: { value: new THREE.Color(0x8a9aa8) }, // Soft blue-gray shadows
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
        sizeAttenuation: true,
    });

    const snow = new THREE.Points(geometry, material);
    snow.userData = {
        velocities: Array(count).fill(0).map(() => ({
            y: -0.1 - Math.random() * 0.2,
            x: (Math.random() - 0.5) * 0.05,
            z: (Math.random() - 0.5) * 0.05,
        })),
    };

    return snow;
}

export function updateMountainPeaksEnvironment(group, delta, time, camera, cameraProgress = null) {
    const { uniforms } = group.userData;
    if (uniforms?.uTime) {
        uniforms.uTime.value = time;
    }

    const cameraY = camera?.position?.y ?? group.position.y;
    const yStart = group.userData.yStart ?? MOUNTAIN_PEAKS_CONFIG.yStart;
    const yEnd = group.userData.yEnd ?? MOUNTAIN_PEAKS_CONFIG.yEnd;
    const progressWindow = getMountainChapterProgressWindow();
    const progressStart = progressWindow.start;
    const progressEnd = progressWindow.end;
    let progress = 0;

    if (Number.isFinite(cameraProgress) && progressEnd > progressStart) {
        progress = THREE.MathUtils.clamp(
            (cameraProgress - progressStart) / (progressEnd - progressStart),
            0,
            1,
        );
    } else if (yEnd > yStart) {
        progress = THREE.MathUtils.clamp((cameraY - yStart) / (yEnd - yStart), 0, 1);
    }

    const transition = THREE.MathUtils.smoothstep(
        progress,
        MOUNTAIN_TRANSITION_START,
        MOUNTAIN_TRANSITION_END,
    );

    const { sky } = group.userData;
    if (sky?.material?.uniforms) {
        if (sky.material.uniforms.uTransition) {
            sky.material.uniforms.uTransition.value = transition;
        }
        if (sky.material.uniforms.uOpacity) {
            const baseOpacity = typeof sky.material.uniforms.uOpacity.__odysseyBaseOpacity === 'number'
                ? sky.material.uniforms.uOpacity.__odysseyBaseOpacity
                : sky.material.uniforms.uOpacity.value;
            sky.material.uniforms.uOpacity.value = baseOpacity;
        }
    }

    const mountainTransitionUniformTargets = group.userData.mountainTransitionUniformTargets || [];
    mountainTransitionUniformTargets.forEach((uniform) => {
        uniform.value = transition;
    });

    const mountainOpacityUniformTargets = group.userData.mountainOpacityUniformTargets || [];
    mountainOpacityUniformTargets.forEach((uniform) => {
        const baseOpacity = typeof uniform.__odysseyBaseOpacity === 'number'
            ? uniform.__odysseyBaseOpacity
            : uniform.value;
        uniform.value = baseOpacity;
    });

    const auroraFadeUniformTargets = group.userData.auroraFadeUniformTargets || [];
    auroraFadeUniformTargets.forEach((uniform) => {
        uniform.value = 1;
    });

    const auroraOpacityUniformTargets = group.userData.auroraOpacityUniformTargets || [];
    auroraOpacityUniformTargets.forEach((uniform) => {
        const baseOpacity = typeof uniform.__odysseyBaseOpacity === 'number'
            ? uniform.__odysseyBaseOpacity
            : uniform.value;
        uniform.value = baseOpacity;
    });

    const { snow } = group.userData;
    if (snow) {
        const positions = snow.geometry.attributes.position.array;
        const vels = snow.userData.velocities;

        for (let i = 0; i < vels.length; i++) {
            positions[i * 3] += vels[i].x;
            positions[i * 3 + 1] += vels[i].y;
            positions[i * 3 + 2] += vels[i].z;

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
function getMountainChapterProgressWindow() {
    const chapterPositions = getActiveOdysseyChapterPositions();
    return {
        start: chapterPositions?.[3] ?? 0.352,
        end: chapterPositions?.[4] ?? 0.5,
    };
}
