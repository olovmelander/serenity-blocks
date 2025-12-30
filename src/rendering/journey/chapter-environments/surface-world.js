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


/**
 * Surface World environment configuration
 */
export const SURFACE_WORLD_CONFIG = {
    id: 3,
    name: 'surface-world',
    yStart: 35,
    yEnd: 65,
    colors: {
        primary: 0x87ceeb,    // Sky blue
        secondary: 0x90ee90,  // Light green
        tertiary: 0xffb7c5,   // Sakura pink
        accent: 0xffd700,     // Golden sunlight
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
varying vec3 vWorldPosition;
varying vec2 vUv;

void main() {
    float h = normalize(vWorldPosition + offset).y;
    vec3 sky = mix(bottomColor, topColor, max(pow(max(h , 0.0), exponent), 0.0));
    
    // Add sun glow bleed
    float sunDot = dot(normalize(vWorldPosition), normalize(vec3(0.5, 0.5, -0.5)));
    float sunGlow = smoothstep(0.8, 1.0, sunDot);
    sky += vec3(1.0, 0.9, 0.6) * sunGlow * 0.2;
    
    gl_FragColor = vec4(sky, 1.0);
}
`;

// Ocean Shader (Simplified Water.js look-alike for consistency without texture loading issues)
const oceanVertexShader = `
uniform float uTime;
varying vec2 vUv;
varying vec3 vPosition;
varying vec3 vNormal;

${noiseGLSL}

void main() {
    vUv = uv * 4.0; // Tiling
    vec3 pos = position;
    
    // Gentle rolling waves
    float wave1 = sin(pos.x * 0.05 + uTime * 0.5) * 1.5;
    float wave2 = cos(pos.z * 0.04 + uTime * 0.4) * 1.5;
    float noise = snoise(vec3(pos.xz * 0.02, uTime * 0.2)) * 1.0;
    
    pos.y += wave1 + wave2 + noise;
    
    vPosition = pos;
    vNormal = normalize(normalMatrix * normal);
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const oceanFragmentShader = `
uniform vec3 uColor1; // Deep Blue
uniform vec3 uColor2; // Teal/Greenish
uniform float uTime;
varying vec2 vUv;
varying vec3 vPosition;
varying vec3 vNormal;

${noiseGLSL}

void main() {
    // Water surface noise
    float noise = snoise(vec3(vUv * 5.0, uTime * 0.3));
    
    vec3 viewDir = normalize(cameraPosition - vPosition);
    float fresnel = pow(1.0 - max(dot(viewDir, vec3(0.0, 1.0, 0.0)), 0.0), 3.0);
    
    // Mix colors based on noise and fresnel
    vec3 color = mix(uColor1, uColor2, noise * 0.5 + 0.5);
    color += vec3(0.8, 0.9, 1.0) * fresnel * 0.5; // Specular-ish reflection
    
    // "Foam" tips
    float foam = smoothstep(0.7, 0.8, noise);
    color += vec3(1.0) * foam * 0.3;
    
    gl_FragColor = vec4(color, 0.9);
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
    
    // Lighting
    vec3 lightDir = normalize(vec3(0.5, 1.0, 0.5));
    float diff = max(dot(vNormal, lightDir), 0.0);
    color *= (0.4 + diff * 0.6);
    
    // Distance fog (simple)
    float dist = length(vPosition.xz);
    float fog = smoothstep(100.0, 250.0, dist);
    color = mix(color, vec3(0.7, 0.9, 1.0), fog); // Fade to sky
    
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
    
    float alpha = smoothstep(0.2, 0.8, noiseSum + 0.5) * mask * 0.4;
    
    vec3 color = vec3(1.0, 1.0, 1.0);
    gl_FragColor = vec4(color, alpha);
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

    // 1. Sky Background
    const sky = createSkyBackground(uniforms);
    group.add(sky);

    // 2. Ocean Surface (Bottom)
    const ocean = createOceanSurface(uniforms);
    group.add(ocean);

    // 3. Distant Landscape/Islands
    const landscape = createLandscape(uniforms);
    group.add(landscape);

    // 4. High Quality Fluffy Grass (Removed per user request due to floating artifacts)
    // const grass = createFluffyGrass(uniforms, 1000); 
    // group.add(grass);

    // 5. Volumetric Sun Rays
    const rays = createSunRays(uniforms);
    group.add(rays);

    // 6. Soft Procedural Clouds
    const clouds = createClouds(uniforms);
    group.add(clouds);

    // 7. Petals (Updated)
    const petals = createPetals(uniforms, 600);
    group.add(petals);

    // 8. Butterflies
    const butterflies = createButterflies(20);
    group.add(butterflies);
    group.userData.butterflies = butterflies;

    const ambient = new THREE.AmbientLight(0xffeedd, 0.6);
    group.add(ambient);
    const sunLight = new THREE.DirectionalLight(0xffaa33, 0.8);
    sunLight.position.set(50, 100, 20);
    group.add(sunLight);

    group.position.y = (SURFACE_WORLD_CONFIG.yStart + SURFACE_WORLD_CONFIG.yEnd) / 2;

    return group;
}

function createSkyBackground(uniforms) {
    const geometry = new THREE.SphereGeometry(300, 64, 48);
    const material = new THREE.ShaderMaterial({
        uniforms: {
            topColor: { value: new THREE.Color(0x5ca8ff) },
            bottomColor: { value: new THREE.Color(0xcceeff) },
            offset: { value: 10 },
            exponent: { value: 0.6 },
            uTime: uniforms.uTime
        },
        vertexShader: skyVertexShader,
        fragmentShader: skyFragmentShader,
        side: THREE.BackSide,
        depthWrite: false
    });
    return new THREE.Mesh(geometry, material);
}

function createOceanSurface(uniforms) {
    const geometry = new THREE.PlaneGeometry(300, 300, 64, 64);
    geometry.rotateX(-Math.PI / 2);

    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: uniforms.uTime,
            uColor1: { value: new THREE.Color(0x003344) }, // Darker ocean
            uColor2: { value: new THREE.Color(0x005566) }
        },
        vertexShader: oceanVertexShader,
        fragmentShader: oceanFragmentShader,
        transparent: true,
        opacity: 0.9,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = -15; // Bottom of the section (approx surface level)
    return mesh;
}

// Helper for CPU-side height generation
function smoothstep(min, max, value) {
    var x = Math.max(0, Math.min(1, (value - min) / (max - min)));
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
    distFactor = Math.pow(distFactor, 2.0); // Curve it

    // Height: Start deep (-30), rise to max height (20)
    let baseH = -30.0 + (distFactor * 50.0);

    // Add noise only at distance
    let h = baseH + (noise * smoothstep(50, 100, d));

    // Flatten water area explicitly
    if (h < -2.0) {
        h = -15.0; // Ocean floor
    }

    return h;
}

function createLandscape(uniforms) {
    const geometry = new THREE.PlaneGeometry(400, 400, 128, 128);
    geometry.rotateX(-Math.PI / 2);

    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);

        let h = getTerrainHeight(x, z);
        pos.setY(i, h);
    }
    geometry.computeVertexNormals();

    const material = new THREE.ShaderMaterial({
        uniforms: {
            uColorLow: { value: new THREE.Color(0xd4e1a6) }, // Sand
            uColorHigh: { value: new THREE.Color(0x558855) }, // Forest Green
        },
        vertexShader: terrainVertexShader,
        fragmentShader: `
            uniform vec3 uColorLow;
            uniform vec3 uColorHigh;
            varying vec3 vNormal;
            varying vec3 vPosition;

            void main() {
                // Transparency for water (let ocean plane show through)
                // Water plane is at -15.
                if (vPosition.y < -5.0) discard;

                // Height gradient: Sand (-5 to 2) -> Grass (>2)
                float h = smoothstep(-2.0, 10.0, vPosition.y);
                
                vec3 sand = vec3(0.76, 0.70, 0.50); // Beach sand
                vec3 grass = vec3(0.2, 0.5, 0.2);   // Forest grass
                
                // Color mixing
                vec3 color = mix(sand, grass, h);
                
                // Add noise/texture detail (simple)
                float noise = sin(vPosition.x * 0.5) * cos(vPosition.z * 0.5);
                color += noise * 0.05;

                // Lighting
                vec3 lightDir = normalize(vec3(0.5, 1.0, 0.5));
                float diff = max(dot(vNormal, lightDir), 0.0);
                color *= (0.5 + diff * 0.5);
                
                // Distance fog
                float dist = length(vPosition.xz);
                float fog = smoothstep(120.0, 200.0, dist);
                color = mix(color, vec3(0.7, 0.9, 1.0), fog);
                
                gl_FragColor = vec4(color, 1.0);
            }
        `,
        transparent: true
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
            uColorTop: { value: new THREE.Color(0xaaffaa) }
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
        blending: THREE.AdditiveBlending
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
        blending: THREE.NormalBlending
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

function createPetals(uniforms, count) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const randoms = new Float32Array(count);
    const sizes = new Float32Array(count);
    const colors = new Float32Array(count * 3);

    const palette = [
        new THREE.Color(0xffc0cb),
        new THREE.Color(0xffe4e1),
        new THREE.Color(0xffb7c5)
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
        depthWrite: false
    });

    return new THREE.Points(geometry, material);
}

function createButterflies(count) {
    const group = new THREE.Group();
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial({
        color: 0xffaa00,
        side: THREE.DoubleSide
    });

    for (let i = 0; i < count; i++) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData = {
            speed: 0.5 + Math.random(),
            offset: Math.random() * 100
        };
        group.add(mesh);
    }
    return group;
}

export function updateSurfaceWorldEnvironment(group, delta, time) {
    const uniforms = group.userData.uniforms;
    if (uniforms?.uTime) {
        uniforms.uTime.value = time;
    }

    const butterflies = group.userData.butterflies;
    if (butterflies) {
        butterflies.children.forEach(b => {
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
