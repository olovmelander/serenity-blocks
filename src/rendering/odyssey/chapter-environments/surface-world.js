/**
 * @fileoverview Surface World Environment - Chapter 3 Visual Theme
 *
 * Enhanced Version:
 * - High-Quality Fluffy Grass (Sakura-style billboards) on Terrain
 * - "Rainy Window" style Ocean Surface at horizon
 * - Distant Sakura Landscape/Islands
 * - Volumetric Golden Sun Rays
 * - Flowing "God Ray" Atmosphere
 * - Soft Procedural Clouds
 * - Fluttering Petals & Butterflies
 */

import * as THREE from 'three';
import { getChapterPathRange } from '../path-utils.js';

/**
 * Surface World environment configuration
 */
export const SURFACE_WORLD_CONFIG = {
    id: 3,
    name: 'surface-world',
    yStart: 52.5,
    yEnd: 97.5,
    transitionZone: 0.06, // Much earlier fade-in for maximum overlap
    colors: {
        primary: 0x87ceeb, // Sky blue
        secondary: 0x90ee90, // Light green
        tertiary: 0xffb7c5, // Sakura pink
        accent: 0xffd700, // Golden sunlight
        background: 0xc8e6c9, // Soft green fog
    },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED UTILS
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
// SHADERS
// ═══════════════════════════════════════════════════════════════════════════════

const skyVertexShader = `
varying vec3 vWorldPosition;
// Pass UVs for texturing if needed
varying vec2 vUv;
void main() {
    vUv = uv;
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
uniform float uTime;
uniform float uOpacity;
varying vec3 vWorldPosition;
varying vec2 vUv;

void main() {
    float h = normalize(vWorldPosition + offset).y;
    vec3 sky = mix(bottomColor, topColor, max(pow(max(h , 0.0), exponent), 0.0));
    
    // Add sun glow bleed (reduced intensity)
    float sunDot = dot(normalize(vWorldPosition), normalize(vec3(0.5, 0.5, -0.5)));
    float sunGlow = smoothstep(0.85, 1.0, sunDot);
    sky += vec3(1.0, 0.95, 0.7) * sunGlow * 0.1;
    
    gl_FragColor = vec4(sky, uOpacity);
}
`;

// Ocean Shader - Same as Deep Ocean for consistent water appearance
const oceanVertexShader = `
uniform float uTime;
varying vec3 vPosition;
varying vec2 vUv;
varying float vElevation;

// Gerstner wave
vec3 gerstnerWave(vec2 dir, float steep, float wlen, vec3 p, float t) {
    float k = 6.28318 / wlen;
    float c = sqrt(9.8 / k);
    vec2 d = normalize(dir);
    float f = k * (dot(d, p.xz) - c * t);
    float a = steep / k;
    return vec3(d.x * a * cos(f), a * sin(f), d.y * a * cos(f));
}

${noiseGLSL}

void main() {
    vUv = uv;
    vec3 pos = position;
    float time = uTime * 0.5;
    
    // Gerstner waves - calmer for paradise water
    vec3 wave = vec3(0.0);
    wave += gerstnerWave(vec2(1.0, 0.3), 0.08, 35.0, pos, time * 0.7);  // Reduced steepness, longer wavelength
    wave += gerstnerWave(vec2(0.7, 0.7), 0.05, 28.0, pos, time * 0.8);
    
    // Perlin noise detail - reduced for calmer water
    float noise = snoise(vec3(pos.xz * 0.05, time * 0.2)) * 0.8;
    
    float displacement = wave.y + noise;
    vElevation = displacement;
    
    pos.y += displacement;
    pos.x += wave.x;
    pos.z += wave.z;
    
    vPosition = pos;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const oceanFragmentShader = `
uniform float uTime;
uniform vec3 uColor1;
uniform vec3 uColor2;

varying vec3 vPosition;
varying vec2 vUv;
varying float vElevation;

${noiseGLSL}

void main() {
    // Caustics pattern - same as deep ocean
    vec2 causticsUV = vPosition.xz * 0.15;
    float c1 = snoise(vec3(causticsUV, uTime * 0.2));
    float c2 = snoise(vec3(causticsUV * 1.4, uTime * -0.15));
    float caustics = (c1 + c2) * 0.5 + 0.5;
    caustics = pow(caustics, 3.0);
    
    // Mix colors based on elevation
    vec3 color = mix(uColor1, uColor2, vElevation * 0.1 + 0.5);
    
    // Add caustics
    color += vec3(0.6, 0.9, 1.0) * caustics * 0.4;
    
    // Fresnel effect for surface view
    vec3 viewDir = normalize(cameraPosition - vPosition);
    float fresnel = pow(1.0 - max(dot(viewDir, vec3(0.0, 1.0, 0.0)), 0.0), 3.0);
    color += vec3(0.8, 0.9, 1.0) * fresnel * 0.3;
    
    // Edge fade
    float dist = length(vUv - 0.5) * 2.0;
    float alpha = 1.0 - smoothstep(0.8, 1.0, dist);
    
    gl_FragColor = vec4(color, alpha * 0.9);
}
`;

const terrainVertexShader = `
varying vec3 vNormal;
varying vec3 vPosition;
void main() {
    vNormal = normalize(normalMatrix * normal);
    vPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const terrainFragmentShader = `
uniform vec3 uColorLow;
uniform vec3 uColorHigh;
varying vec3 vNormal;
varying vec3 vPosition;

void main() {
    // Height based gradient
    float h = smoothstep(-10.0, 30.0, vPosition.y);
    vec3 color = mix(uColorLow, uColorHigh, h);
    
    // Lighting - more ambient, less diffuse to preserve saturation
    vec3 lightDir = normalize(vec3(0.5, 1.0, 0.5));
    float diff = max(dot(vNormal, lightDir), 0.0);
    // Reduced diffuse contribution to prevent washout
    color *= (0.6 + diff * 0.4);
    
    // Distance fog (simple)
    float dist = length(vPosition.xz);
    // Push fog start back to keep foreground vibrant
    float fog = smoothstep(150.0, 300.0, dist);
    color = mix(color, vec3(0.72, 0.88, 1.0), fog); // Fade to sky (matches new bottomColor 0xb8e2ff)
    
    gl_FragColor = vec4(color, 1.0);
}
`;

const sunRayVertexShader = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const sunRayFragmentShader = `
uniform float uTime;
varying vec2 vUv;

void main() {
    float edgeFade = 1.0 - pow(abs(vUv.x - 0.5) * 2.5, 2.0);
    float bottomFade = smoothstep(0.0, 0.3, vUv.y);
    float topFade = 1.0 - smoothstep(0.8, 1.0, vUv.y);
    float shimmer = sin(vUv.y * 10.0 - uTime * 0.5) * 0.1 + 0.9;
    float beam = smoothstep(0.3, 0.7, sin(vUv.x * 20.0 + uTime * 0.2) * 0.5 + 0.5);
    
    float alpha = edgeFade * bottomFade * topFade * shimmer * (0.1 + beam * 0.1);
    
    vec3 color = vec3(1.0, 0.95, 0.8);
    gl_FragColor = vec4(color, alpha * 0.4);
}
`;

const grassVertexShader = `
uniform float uTime;
varying vec2 vUv;
varying float vHeight;

void main() {
    vUv = uv;
    vHeight = uv.y;
    
    vec3 pos = position;
    
    // Wind swaying
    float wind = sin(uTime * 0.5 + pos.x * 0.1 + pos.z * 0.1) * 0.2;
    float wind2 = cos(uTime * 0.7 + pos.z * 0.2) * 0.1;
    
    float sway = uv.y * uv.y * 2.0;
    pos.x += wind * sway;
    pos.z += wind2 * sway;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const grassFragmentShader = `
uniform sampler2D uGrassTexture;
uniform vec3 uColorBottom;
uniform vec3 uColorTop;
varying vec2 vUv;

void main() {
    vec4 texColor = texture2D(uGrassTexture, vUv);
    if (texColor.a < 0.5) discard;
    vec3 color = mix(uColorBottom, uColorTop, vUv.y);
    color *= texColor.rgb;
    gl_FragColor = vec4(color, 1.0);
}
`;

const cloudVertexShader = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const cloudFragmentShader = `
uniform float uTime;
varying vec2 vUv;
${noiseGLSL}

void main() {
    float scale = 3.0;
    float t = uTime * 0.05;
    
    float n1 = snoise(vec3(vUv.x * scale + t, vUv.y * scale, t));
    float n2 = snoise(vec3(vUv.x * scale * 2.0 - t, vUv.y * scale * 2.0, t * 1.5)) * 0.5;
    
    float noiseSum = n1 + n2;
    
    float dist = length(vUv - 0.5) * 2.0;
    float mask = 1.0 - smoothstep(0.3, 1.0, dist);
    
    float alpha = smoothstep(0.2, 0.8, noiseSum + 0.5) * mask * 0.35;

    vec3 color = vec3(0.95, 0.97, 1.0); // Slight blue tint, less harsh white
    gl_FragColor = vec4(color, alpha);
}
`;

// ═══════════════════════════════════════════════════════════════════════════════
// DISTANT MOUNTAINS (Same style as Chapter 4)
// ═══════════════════════════════════════════════════════════════════════════════

const distantMountainVertexShader = `
attribute float aHeight;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying float vHeight;

void main() {
    vNormal = normalize(normalMatrix * normal);
    vHeight = aHeight;
    
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const distantMountainFragmentShader = `
uniform vec3 uSnowColor;
uniform vec3 uRockColor;
uniform vec3 uFogColor;
uniform float uSnowLine;
uniform float uSnowBlend;
uniform float uOpacity;

varying vec3 vNormal;
varying vec3 vWorldPosition;
varying float vHeight;

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
    vec3 lightDir = normalize(vec3(0.5, 0.8, 0.5));
    float diff = max(0.3, dot(vNormal, lightDir));
    
    vec3 rock = uRockColor * diff;
    vec3 snow = uSnowColor * diff;
    
    // Snow pattern
    float snowNoise = fbm(vWorldPosition.xz * 0.05);
    float snowThresh = uSnowLine + snowNoise * 0.2;
    float slope = 1.0 - abs(dot(vNormal, vec3(0.0, 1.0, 0.0)));
    float slopeFactor = smoothstep(0.7, 0.4, slope);
    
    float snowLine = mix(uSnowLine + 0.05, uSnowLine - 0.15, uSnowBlend);
    float snowMix = smoothstep(snowLine - 0.1, snowLine + 0.1, vHeight);
    snowMix *= slopeFactor;
    
    vec3 color = mix(rock, snow, snowMix);
    
    // Atmospheric fog for distant mountains
    // Must be visible at z = -400 to -600, so fog starts late
    float dist = length(vWorldPosition - cameraPosition);
    float fogFactor = smoothstep(300.0, 1200.0, dist);
    
    // Fade to sky/haze
    color = mix(color, uFogColor, fogFactor);
    color = mix(color, uSnowColor, uSnowBlend * 0.08);
    
    gl_FragColor = vec4(color, uOpacity);
}
`;

// ═══════════════════════════════════════════════════════════════════════════════
// ENVIRONMENT CREATION
// ═══════════════════════════════════════════════════════════════════════════════

export function createSurfaceWorldEnvironment(options = {}) {
    const group = new THREE.Group();
    group.name = 'surface-world-environment';
    group.userData.chapterId = 3;
    group.userData.yStart = SURFACE_WORLD_CONFIG.yStart;
    group.userData.yEnd = SURFACE_WORLD_CONFIG.yEnd;

    const uniforms = { uTime: { value: 0 } };
    group.userData.uniforms = uniforms;

    const chapterRange = getChapterPathRange(3);
    const chapter4Range = getChapterPathRange(4);
    const fallbackCenterY = (SURFACE_WORLD_CONFIG.yStart + SURFACE_WORLD_CONFIG.yEnd) / 2;
    const chapterCenterY = chapterRange?.center.y ?? fallbackCenterY;
    const surfaceOffsetY = chapterRange
        ? chapterRange.start.y - chapterCenterY
        : -15;
    const surfaceWorldY = chapterCenterY + surfaceOffsetY;

    if (chapterRange) {
        group.userData.yStart = chapterRange.start.y;
        group.userData.yEnd = chapterRange.end.y;
    }

    const snowTransitionEndY = chapter4Range?.start.y ?? group.userData.yEnd;
    const snowTransitionRange = chapterRange
        ? (chapterRange.end.y - chapterRange.start.y) * 0.4
        : 18;
    group.userData.snowTransition = {
        endY: snowTransitionEndY,
        range: snowTransitionRange,
    };

    // 1. Sky Background
    const sky = createSkyBackground(uniforms);
    sky.name = 'sky';
    group.add(sky);

    // 2. Ocean Surface (Bottom) - visible from above and below
    const ocean = createOceanSurface(uniforms, surfaceOffsetY);
    ocean.name = 'ocean-surface';
    group.add(ocean);

    // 3. Distant Landscape/Islands - only visible above water
    const landscape = createLandscape(uniforms, surfaceWorldY);
    landscape.name = 'landscape';
    group.add(landscape);
    group.userData.landscape = landscape;

    // 3.5 Distant Mountains on horizon (same style as Chapter 4)
    const distantMountains = createDistantMountains(uniforms);
    distantMountains.name = 'distant-mountains';
    group.add(distantMountains);
    group.userData.distantMountains = distantMountains;
    group.userData.snowFloor = distantMountains.userData.snowFloor;

    // 4. High Quality Fluffy Grass (Removed per user request due to floating artifacts)
    // const grass = createFluffyGrass(uniforms, 1000);
    // group.add(grass);

    // 5. Volumetric Sun Rays - only visible above water
    const rays = createSunRays(uniforms);
    rays.name = 'sun-rays';
    group.add(rays);

    // 6. Soft Procedural Clouds - only visible above water
    const clouds = createClouds(uniforms);
    clouds.name = 'clouds';
    group.add(clouds);

    // 7. Petals (Updated) - only visible above water
    const petals = createPetals(uniforms, 600);
    petals.name = 'petals';
    group.add(petals);

    // 8. Butterflies - only visible above water
    const butterflies = createButterflies(20);
    butterflies.name = 'butterflies';
    group.add(butterflies);
    group.userData.butterflies = butterflies;

    const ambient = new THREE.AmbientLight(0xffeedd, 0.5); // Slightly brighter ambient for color fidelity
    group.add(ambient);
    const sunLight = new THREE.DirectionalLight(0xffaa33, 0.5); // Reduced direct sun to prevent washout
    sunLight.position.set(50, 100, 20);
    group.add(sunLight);

    // Store references to surface-only elements for visibility toggling
    // Include ocean surface and mountains - only visible from above
    group.userData.surfaceElements = [ocean, landscape, distantMountains, rays, clouds, petals, butterflies];
    group.userData.skyElement = sky;
    group.userData.waterSurfaceY = surfaceWorldY;

    group.position.y = chapterCenterY;

    return group;
}

function createSkyBackground(uniforms) {
    const geometry = new THREE.SphereGeometry(2500, 64, 48);
    const material = new THREE.ShaderMaterial({
        uniforms: {
            topColor: { value: new THREE.Color(0x4a9eeb) }, // Deeper Sky Blue
            bottomColor: { value: new THREE.Color(0x8ecfff) }, // Softer Horizon
            offset: { value: 10 },
            exponent: { value: 0.6 },
            uTime: uniforms.uTime,
            uOpacity: { value: 1 },
        },
        vertexShader: skyVertexShader,
        fragmentShader: skyFragmentShader,
        side: THREE.BackSide,
        depthWrite: false,
        transparent: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = -100;
    return mesh;
}

function createOceanSurface(uniforms, surfaceOffsetY = -15) {
    const geometry = new THREE.PlaneGeometry(300, 300, 64, 64);
    geometry.rotateX(-Math.PI / 2);

    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: uniforms.uTime,
            uColor1: { value: new THREE.Color(0x00aacc) }, // Tropical turquoise
            uColor2: { value: new THREE.Color(0x40e0d0) }, // Clear paradise blue
        },
        vertexShader: oceanVertexShader,
        fragmentShader: oceanFragmentShader,
        transparent: true,
        opacity: 0.9,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = surfaceOffsetY;
    return mesh;
}

// Helper for CPU-side height generation
function smoothstep(min, max, value) {
    const x = Math.max(0, Math.min(1, (value - min) / (max - min)));
    return x * x * (3 - 2 * x);
}

function getTerrainHeight(x, z) {
    // OPEN OCEAN LOGIC
    // We want the player to perceive they are in the middle of the ocean.
    // Land should be distant.

    // Distance from center (0,0)
    const d = Math.sqrt(x * x + z * z);

    // Hard "Ocean Zone" radius
    // Anything within radius 60 is DEEP WATER.
    // Transition from 60 to 100.

    // Base noise for texture
    let noise = Math.sin(x * 0.05) * Math.sin(z * 0.05) * 5;
    noise += Math.sin(x * 0.1 + z * 0.2) * 2;

    // Island shape function (Inverse crater)
    // We want low in center, high in distance.
    // Normalized distance factor (0 at center, 1 at edge)
    const viewDist = 180.0;
    let distFactor = Math.min(d / viewDist, 1.0);
    distFactor **= 2.0; // Curve it

    // Height: Start deep (-30), rise to max height (20)
    const baseH = -30.0 + (distFactor * 50.0);

    // Add noise only at distance
    let h = baseH + (noise * smoothstep(50, 100, d));

    // Flatten water area explicitly
    if (h < -2.0) {
        h = -15.0; // Ocean floor
    }

    return h;
}

function createLandscape(uniforms, waterLevel = 60.0) {
    const geometry = new THREE.PlaneGeometry(400, 400, 128, 128);
    geometry.rotateX(-Math.PI / 2);

    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);

        const h = getTerrainHeight(x, z);
        pos.setY(i, h);
    }
    geometry.computeVertexNormals();

    const material = new THREE.ShaderMaterial({
        uniforms: {
            uColorLow: { value: new THREE.Color(0x77ff00) }, // Neon Lime (Ball Color match)
            uColorHigh: { value: new THREE.Color(0x00cc44) }, // Vivid Emerald
            uWaterLevel: { value: waterLevel },
            uSnowBlend: { value: 0 },
            uSnowColor: { value: new THREE.Color(0xf2f7ff) },
            uSnowShadow: { value: new THREE.Color(0x9fb0c2) },
            uOpacity: { value: 1 },
        },
        vertexShader: `
            varying vec3 vNormal;
            varying vec3 vPosition;
            varying vec3 vWorldPosition;
            
            void main() {
                vNormal = normalize(normalMatrix * normal);
                vPosition = (modelMatrix * vec4(position, 1.0)).xyz;
                vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 uColorLow;
            uniform vec3 uColorHigh;
            uniform float uWaterLevel;
            uniform float uSnowBlend;
            uniform vec3 uSnowColor;
            uniform vec3 uSnowShadow;
            uniform float uOpacity;
            varying vec3 vNormal;
            varying vec3 vPosition;
            varying vec3 vWorldPosition;

            float rand(vec2 p) {
                return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
            }

            float noise(vec2 p) {
                vec2 i = floor(p);
                vec2 f = fract(p);
                f = f * f * (3.0 - 2.0 * f);
                float a = rand(i);
                float b = rand(i + vec2(1.0, 0.0));
                float c = rand(i + vec2(0.0, 1.0));
                float d = rand(i + vec2(1.0, 1.0));
                return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
            }

            void main() {
                // Hide terrain completely when below water surface (y < -5 relative to group)
                // if (vPosition.y < -5.0) discard; // Removed to allow smooth fade from below water

                // Height based gradient
                // Shore/Sand layer near water level
                // Map elevation relative to water level (35.0)
                float relHeight = vPosition.y - uWaterLevel;
                float sandAmount = smoothstep(1.0, 6.0, relHeight); // 0 at water+1, 1 at water+6
                
                vec3 sandColor = vec3(0.93, 0.88, 0.68); // Warm beach sand
                
                // Grass gradient for higher elevations - slightly darkened from neon
                vec3 grassColorLow = vec3(0.2, 0.8, 0.1); // Natural vibrant green
                vec3 grassColorHigh = vec3(0.0, 0.6, 0.2); // Darker lush green
                vec3 grassColor = mix(grassColorLow, grassColorHigh, smoothstep(5.0, 30.0, relHeight));
                
                // Mix sand to grass
                vec3 color = mix(sandColor, grassColor, sandAmount);
                
                // Add subtle noise texture to ground to break up plastic look
                float groundNoise = fract(sin(dot(vPosition.xz * 0.1, vec2(12.9898, 78.233))) * 43758.5453);
                color = mix(color, color * 0.9, groundNoise * 0.15);

                // Lighting - Very soft and vivid (almost unlit/toon)
                vec3 lightDir = normalize(vec3(0.5, 1.0, 0.5));
                float diff = max(dot(vNormal, lightDir), 0.0);
                // High ambient, low diffuse variation to keep it consistent and vivid
                color *= (0.85 + diff * 0.15);
                
                // Distance fog (simple)
                float dist = length(vPosition.xz);
                // Push fog start back to keep foreground vibrant
                float fog = smoothstep(150.0, 300.0, dist);
                color = mix(color, vec3(0.53, 0.8, 1.0), fog * 0.8); 
                
                float snowNoise = noise(vPosition.xz * 0.06);
                float snowHeight = smoothstep(6.0, 20.0, relHeight);
                float snowPatch = smoothstep(0.35, 0.75, snowNoise);

                float farSnow = 1.0 - smoothstep(-260.0, -140.0, vPosition.z);
                float farSnowNoise = 1.0 - smoothstep(-260.0, -140.0, vPosition.z + snowNoise * 60.0);

                float snowMask = max(snowPatch * snowHeight, farSnowNoise);
                snowMask *= uSnowBlend;

                vec3 snowTint = mix(uSnowShadow, uSnowColor, 0.65 + snowNoise * 0.35);
                color = mix(color, snowTint, snowMask);

                gl_FragColor = vec4(color, uOpacity);
            }
        `,
        transparent: true,
        depthWrite: false,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = -15; // Base level
    return mesh;
}

function createGrassTexture() {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.clearRect(0, 0, 512, 512);
    const drawBlade = (x, height, width, lean, color) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x - width / 2, 512);
        ctx.quadraticCurveTo(x + lean, 512 - height / 2, x + lean * 2, 512 - height);
        ctx.quadraticCurveTo(x + lean + width / 2, 512 - height / 2, x + width / 2, 512);
        ctx.fill();
    };
    for (let i = 0; i < 150; i++) {
        const x = Math.random() * 512;
        const h = 200 + Math.random() * 300;
        const w = 15 + Math.random() * 20;
        const l = (Math.random() - 0.5) * 100;
        const lightness = 30 + Math.random() * 40;
        const color = `hsl(100, 50%, ${lightness}%)`;
        drawBlade(x, h, w, l, color);
    }
    return new THREE.CanvasTexture(canvas);
}

function createFluffyGrass(uniforms, count) {
    const grassTexture = createGrassTexture();
    if (!grassTexture) return new THREE.Group();

    const planeGeo = new THREE.PlaneGeometry(8, 8);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = planeGeo.index;
    geometry.attributes = planeGeo.attributes;

    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: uniforms.uTime,
            uGrassTexture: { value: grassTexture },
            uColorBottom: { value: new THREE.Color(0x2d5a27) },
            uColorTop: { value: new THREE.Color(0xaaffaa) },
        },
        vertexShader: grassVertexShader,
        fragmentShader: grassFragmentShader,
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
    });

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const dummy = new THREE.Object3D();

    let instanceCount = 0;
    for (let i = 0; i < count; i++) {
        const x = (Math.random() - 0.5) * 350;
        const z = (Math.random() - 0.5) * 350;

        const h = getTerrainHeight(x, z);

        // Strict height check: Only on "land" (h > 4.0)
        // This ensures grass only appears on the distant hills
        if (h < 4.0) continue;

        const dummyScale = 0.5 + Math.random() * 0.5;

        dummy.position.set(x, h + 1.5, z); // Adjust Y for base
        dummy.rotation.y = Math.random() * Math.PI;
        dummy.scale.set(dummyScale, dummyScale, dummyScale);
        dummy.updateMatrix();

        mesh.setMatrixAt(instanceCount, dummy.matrix);
        instanceCount++;
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = instanceCount;

    // Push Y down to match landscape group offset
    mesh.position.y = -15;

    return mesh;
}

function createSunRays(uniforms) {
    const group = new THREE.Group();
    const geometry = new THREE.PlaneGeometry(30, 120);
    const material = new THREE.ShaderMaterial({
        uniforms: { uTime: uniforms.uTime },
        vertexShader: sunRayVertexShader,
        fragmentShader: sunRayFragmentShader,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });

    for (let i = 0; i < 5; i++) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.x = (Math.random() - 0.5) * 80;
        mesh.position.y = 20;
        mesh.position.z = -30 - Math.random() * 40;
        mesh.rotation.z = (Math.random() - 0.5) * 0.4;
        group.add(mesh);
    }
    return group;
}

function createClouds(uniforms) {
    const group = new THREE.Group();
    const geometry = new THREE.PlaneGeometry(60, 30);
    const material = new THREE.ShaderMaterial({
        uniforms: { uTime: uniforms.uTime },
        vertexShader: cloudVertexShader,
        fragmentShader: cloudFragmentShader,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.NormalBlending,
    });

    for (let i = 0; i < 6; i++) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.x = (Math.random() - 0.5) * 120;
        mesh.position.y = 20 + Math.random() * 20;
        mesh.position.z = -80 - Math.random() * 50;
        mesh.scale.setScalar(1.0 + Math.random() * 0.5);
        group.add(mesh);
    }
    return group;
}

/**
 * Creates distant mountains on the horizon (same style as Chapter 4)
 */
function createDistantMountains(uniforms) {
    const group = new THREE.Group();
    group.name = 'distant-mountains';

    // FBM noise helpers
    const fract = (n) => n - Math.floor(n);
    const mix = (a, b, t) => a * (1 - t) + b * t;
    const rand = (x, y, seed) => Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453;
    const noise = (x, y, seed) => {
        const i = Math.floor(x);
        const j = Math.floor(y);
        const f = fract(x);
        const g = fract(y);
        const u = f * f * (3.0 - 2.0 * f);
        const v = g * g * (3.0 - 2.0 * g);
        return mix(
            mix(fract(rand(i, j, seed)), fract(rand(i + 1, j, seed)), u),
            mix(fract(rand(i, j + 1, seed)), fract(rand(i + 1, j + 1, seed)), u),
            v,
        );
    };
    const fbm = (x, y, seed) => {
        let v = 0.0;
        let a = 0.5;
        for (let i = 0; i < 5; i++) {
            v += a * noise(x, y, seed);
            x *= 2.0;
            y *= 2.0;
            a *= 0.5;
        }
        return v;
    };

    // Create mountain mesh helper
    const createMountain = (config) => {
        const segments = 128;
        const geometry = new THREE.PlaneGeometry(config.size, config.size, segments, segments);
        geometry.rotateX(-Math.PI / 2);

        const posAttribute = geometry.attributes.position;
        const vertex = new THREE.Vector3();
        const heights = [];
        const seed = config.seed || 0;

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
            const n = fbm(vertex.x * 0.01, vertex.z * 0.01, seed);
            const n2 = fbm(vertex.x * 0.04, vertex.z * 0.04, seed + 10.0);

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
                uRockColor: { value: new THREE.Color(0x4a5a6a) }, // Slightly bluer for distance
                uFogColor: { value: new THREE.Color(0xb8e2ff) }, // Sky-colored fog (matches new sky)
                uSnowLine: { value: 0.35 },
                uSnowBlend: { value: 0 },
                uOpacity: { value: 1 },
            },
            vertexShader: distantMountainVertexShader,
            fragmentShader: distantMountainFragmentShader,
            transparent: true,
            depthWrite: false,
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(config.position);
        return mesh;
    };

    // Create 3 distant mountain peaks on the horizon
    // Shifted LEFT and positioned for visibility

    // Left mountain (Matches Ch4 Mountain 1)
    group.add(createMountain({
        size: 800,
        height: 300,
        position: new THREE.Vector3(-250, -10, -650), // Lowered by 40 for hiding base
        seed: 12.34,
    }));

    // Center peak (Matches Ch4 Mountain 3)
    group.add(createMountain({
        size: 1200,
        height: 500,
        position: new THREE.Vector3(0, -30, -900), // Lowered by 40
        seed: 89.12,
    }));

    // Right mountain (Matches Ch4 Mountain 2)
    group.add(createMountain({
        size: 800,
        height: 280,
        position: new THREE.Vector3(250, -20, -700), // Lowered by 40
        seed: 45.67,
    }));

    // Add mist at the base to hide "floating" and simulate winter transition
    const mist = createMountainMist(uniforms);
    group.add(mist);
    group.userData.snowFloor = mist;

    return group;
}

function createPetals(uniforms, count) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const randoms = new Float32Array(count);
    const sizes = new Float32Array(count);
    const colors = new Float32Array(count * 3);

    const palette = [
        new THREE.Color(0xffc0cb),
        new THREE.Color(0xffe4e1),
        new THREE.Color(0xffb7c5),
    ];

    for (let i = 0; i < count; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 120;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 80;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 60;

        randoms[i] = Math.random();
        sizes[i] = 1.0 + Math.random();

        const col = palette[Math.floor(Math.random() * palette.length)];
        colors[i * 3] = col.r;
        colors[i * 3 + 1] = col.g;
        colors[i * 3 + 2] = col.b;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

    const vShader = `
        uniform float uTime;
        attribute float aRandom;
        attribute float aSize;
        attribute vec3 aColor;
        varying vec3 vColor;
        void main() {
            vColor = aColor;
            vec3 pos = position;
            
            float fallSpeed = 2.0 + aRandom;
            float yOffset = mod(uTime * fallSpeed + aRandom * 100.0, 100.0) - 50.0;
            pos.y -= yOffset;
            
            pos.x += sin(uTime + aRandom * 10.0) * 5.0;
            pos.z += cos(uTime * 0.7 + aRandom * 5.0) * 3.0;
            
            if(pos.y < -40.0) pos.y += 80.0;
            
            vec4 mv = modelViewMatrix * vec4(pos, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = aSize * (150.0 / -mv.z);
        }
    `;

    const fShader = `
        varying vec3 vColor;
        void main() {
            float dist = length(gl_PointCoord - 0.5);
            if(dist > 0.5) discard;
            gl_FragColor = vec4(vColor, 0.8);
        }
    `;

    const material = new THREE.ShaderMaterial({
        uniforms: { uTime: uniforms.uTime },
        vertexShader: vShader,
        fragmentShader: fShader,
        transparent: true,
        depthWrite: false,
    });

    return new THREE.Points(geometry, material);
}

function createButterflies(count) {
    const group = new THREE.Group();
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial({
        color: 0xffaa00,
        side: THREE.DoubleSide,
    });

    for (let i = 0; i < count; i++) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData = {
            speed: 0.5 + Math.random(),
            offset: Math.random() * 100,
        };
        group.add(mesh);
    }
    return group;
}

/**
 * Creates mist/fog at the base of distant mountains to hide their bottom edge
 * and create a smooth transition to winter.
 */
function createMountainMist_Old(uniforms) {
    const group = new THREE.Group();
    group.name = 'mountain-mist';

    // Simple cloud puffs
    const geometry = new THREE.PlaneGeometry(300, 150);

    // Custom shader for soft edges
    const mistMaterial = new THREE.ShaderMaterial({
        uniforms: {
            uTime: uniforms.uTime,
            uColor: { value: new THREE.Color(0xeef2f5) }, // Snowy mist color
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            varying vec2 vUv;
            void main() {
                // Circular soft gradient
                vec2 center = vUv - 0.5;
                float dist = length(center) * 2.0;
                float alpha = smoothstep(1.0, 0.0, dist);
                
                // Bottom fade for grounding
                alpha *= smoothstep(0.0, 0.2, vUv.y);
                
                gl_FragColor = vec4(uColor, alpha * 0.6);
            }
        `,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.NormalBlending,
    });

    // Create a bank of mist at the base of the mountains
    const positions = [
        { x: -250, z: -550 },
        { x: 0, z: -800 },
        { x: 250, z: -600 },
        { x: -100, z: -700 }, // Filler
        { x: 100, z: -650 }, // Filler
    ];

    positions.forEach((pos) => {
        const mesh = new THREE.Mesh(geometry, mistMaterial);
        mesh.position.set(pos.x, 20, pos.z); // Base height
        mesh.rotation.x = -Math.PI * 0.1; // Slight tilt back

        // Randomize
        mesh.position.x += (Math.random() - 0.5) * 50;
        mesh.position.y += (Math.random() - 0.5) * 10;
        mesh.scale.setScalar(1.5 + Math.random());

        group.add(mesh);
    });

    return group;
}

/**
 * Creates a "Snow Floor" at the base of the mountains to transition from green to white
 */
function createMountainMist(uniforms) {
    const group = new THREE.Group();
    group.name = 'mountain-snow-floor';

    // Large horizontal planes for "ground"
    const geometry = new THREE.PlaneGeometry(800, 400);

    // Custom shader for ground fog/snow
    const mistMaterial = new THREE.ShaderMaterial({
        uniforms: {
            uTime: uniforms.uTime,
            uColor: { value: new THREE.Color(0xffffff) }, // Pure white snow
            uSnowBlend: { value: 0 },
            uOpacity: { value: 1 },
        },
        vertexShader: `
            varying vec2 vUv;
            varying float vDist;
            void main() {
                vUv = uv;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                vDist = -mvPosition.z;
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uSnowBlend;
            uniform float uOpacity;
            uniform float uTime;
            varying vec2 vUv;
            varying float vDist;

            // Simple noise function
            float rand(vec2 n) { 
                return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453);
            }

            float noise(vec2 p) {
                vec2 ip = floor(p);
                vec2 u = fract(p);
                u = u*u*(3.0-2.0*u);
                float res = mix(
                    mix(rand(ip), rand(ip+vec2(1.0,0.0)), u.x),
                    mix(rand(ip+vec2(0.0,1.0)), rand(ip+vec2(1.0,1.0)), u.x), u.y);
                return res*res;
            }

            void main() {
                // Soft radial gradient from center
                vec2 center = vUv - 0.5;
                float dist = length(center) * 2.0;
                
                // Edges fade out
                float alpha = smoothstep(1.0, 0.2, dist);
                
                // Noise texturing for "drifts"
                float n = noise(vUv * 10.0 + uTime * 0.05);
                alpha *= (0.6 + n * 0.4);

                gl_FragColor = vec4(uColor, alpha * 0.8 * uSnowBlend * uOpacity);
            }
        `,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.NormalBlending,
    });

    // Create overlapping snow layers - Pushed back to reveal grass
    const positions = [
        // Scaling 1.5 => size 600. Center at -500 => Extends -200 to -800.
        // This touches the landscape end (-200) without covering the grass.
        {
            x: 0, y: -10, z: -500, scale: 1.5, rot: 0,
        },
        {
            x: -250, y: -5, z: -550, scale: 1.2, rot: 0.1,
        },
        {
            x: 250, y: -5, z: -550, scale: 1.2, rot: -0.1,
        },
        {
            x: 0, y: 0, z: -800, scale: 2.0, rot: 0,
        }, // Back filler near mountains
    ];

    positions.forEach((pos) => {
        const mesh = new THREE.Mesh(geometry, mistMaterial);
        mesh.position.set(pos.x, pos.y, pos.z);
        mesh.rotation.x = -Math.PI / 2; // Horizontal ground plane
        mesh.rotation.z = pos.rot;
        mesh.scale.setScalar(pos.scale);
        group.add(mesh);
    });

    return group;
}

export function updateSurfaceWorldEnvironment(group, delta, time, camera) {
    const { uniforms } = group.userData;
    if (uniforms?.uTime) {
        uniforms.uTime.value = time;
    }

    // Camera-based visibility toggle for underwater transition
    // When camera is below water surface, hide surface-only elements
    const waterSurfaceY = group.userData.waterSurfaceY || 35;
    const cameraY = camera?.position?.y ?? 100; // Default to above water
    const isUnderwater = cameraY < waterSurfaceY;

    const { snowTransition } = group.userData;
    const snowBlend = snowTransition
        ? THREE.MathUtils.smoothstep(
            cameraY,
            snowTransition.endY - snowTransition.range,
            snowTransition.endY,
        )
        : 0;

    const { landscape } = group.userData;
    if (landscape?.material?.uniforms?.uSnowBlend) {
        landscape.material.uniforms.uSnowBlend.value = snowBlend;
    }

    const { distantMountains } = group.userData;
    if (distantMountains) {
        distantMountains.traverse((child) => {
            if (child.material?.uniforms?.uSnowBlend) {
                child.material.uniforms.uSnowBlend.value = snowBlend;
            }
        });
    }

    const { snowFloor } = group.userData;
    if (snowFloor) {
        snowFloor.traverse((child) => {
            if (child.material?.uniforms?.uSnowBlend) {
                child.material.uniforms.uSnowBlend.value = snowBlend;
            }
        });
    }

    // Toggle visibility of surface-only elements
    const { surfaceElements } = group.userData;

    // Smooth fade for underwater transition
    // Fade in from 3 units below surface to 10 units above (ghostly entry)
    const fadeStart = waterSurfaceY - 3;
    const fadeEnd = waterSurfaceY + 10;

    let underwaterOpacity = 1.0;
    if (cameraY < fadeEnd) {
        underwaterOpacity = THREE.MathUtils.smoothstep(cameraY, fadeStart, fadeEnd);
    }

    if (surfaceElements) {
        surfaceElements.forEach((element) => {
            if (element) {
                // Ensure visible if we have any opacity
                element.visible = underwaterOpacity > 0;

                // Apply opacity to shaders if supported
                // We multiply with existing material opacity to respect global fade
                if (element.material && element.material.uniforms?.uOpacity) {
                    // Check if we have baseOpacity stored from ChapterEnvironmentManager
                    // If not, we might be fighting with it, but since we are fading IN from bottom,
                    // the global fade should be 1.0 (since we are in the chapter).
                    // This local fade acts as a "below water" mask.

                    // Note: ChapterEnvironmentManager sets uOpacity directly.
                    // We need to apply this factor ON TOP of whatever the manager sets.
                    // However, we don't know what the manager set exactly without reading it back or tracking it.
                    // But since we run AFTER the manager update in the loop, we can read the current value.

                    const currentOpacity = element.material.uniforms.uOpacity.value;
                    element.material.uniforms.uOpacity.value = currentOpacity * underwaterOpacity;
                }
            }
        });
    }

    // Sky visibility (hide sky sphere when underwater for ocean fade)
    const sky = group.userData.skyElement;
    if (sky) {
        sky.visible = !isUnderwater;
    }

    const { butterflies } = group.userData;
    if (butterflies && !isUnderwater) {
        butterflies.children.forEach((b) => {
            const t = time * b.userData.speed + b.userData.offset;
            b.position.x = Math.sin(t * 0.5) * 30;
            b.position.y = Math.cos(t * 0.3) * 10;
            b.position.z = Math.sin(t * 0.2) * 5 - 20;
            b.rotation.x = Math.sin(t * 10) * 0.5;
            b.rotation.y = Math.atan2(Math.cos(t * 0.5), -Math.sin(t * 0.3));
        });
    }
}

export default {
    config: SURFACE_WORLD_CONFIG,
    create: createSurfaceWorldEnvironment,
    update: updateSurfaceWorldEnvironment,
};
