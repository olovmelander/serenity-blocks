/**
 * @fileoverview Deep Ocean Environment - Chapter 2 Visual Theme
 *
 * Enhanced Version:
 * - Realistic Water Surface (Gerstner Waves + Caustics) from Below
 * - Volumetric Light Rays (God Rays)
 * - Bioluminescent Jellyfish & Plankton
 * - Deep Sea Gradient
 */

import * as THREE from 'three';
import { getChapterPathRange } from '../path-utils.js';

/**
 * Deep Ocean environment configuration
 */
export const DEEP_OCEAN_CONFIG = {
    id: 2,
    name: 'deep-ocean',
    yStart: 7.5,
    yEnd: 52.5,
    transitionZone: 0.005, // Extended fade out for maximum overlap
    colors: {
        primary: 0x0066ff, // Ocean blue
        secondary: 0x00ccff, // Bioluminescent cyan
        accent: 0xff66ff, // Jellyfish glow
        background: 0x001030, // Deep ocean dark
    },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED NOISE UTILS
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
// WATER SURFACE SHADERS (From Ocean Theme)
// ═══════════════════════════════════════════════════════════════════════════════

const waterVertexShader = `
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
    
    // Gerstner waves
    vec3 wave = vec3(0.0);
    wave += gerstnerWave(vec2(1.0, 0.3), 0.2, 25.0, pos, time);
    wave += gerstnerWave(vec2(0.7, 0.7), 0.15, 18.0, pos, time * 1.1);
    
    // Perlin noise detail
    float noise = snoise(vec3(pos.xz * 0.08, time * 0.3)) * 2.0;
    
    float displacement = wave.y + noise;
    vElevation = displacement;
    
    pos.y += displacement;
    pos.x += wave.x;
    pos.z += wave.z;
    
    vPosition = pos;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const waterFragmentShader = `
uniform float uTime;
uniform vec3 uSurfaceColor;
uniform vec3 uDeepColor;

varying vec3 vPosition;
varying vec2 vUv;
varying float vElevation;

${noiseGLSL}

void main() {
    // Caustics pattern
    vec2 causticsUV = vPosition.xz * 0.15;
    float c1 = snoise(vec3(causticsUV, uTime * 0.2));
    float c2 = snoise(vec3(causticsUV * 1.4, uTime * -0.15));
    float caustics = (c1 + c2) * 0.5 + 0.5;
    caustics = pow(caustics, 3.0); // Sharpen
    
    // Mix colors based on elevation
    vec3 color = mix(uDeepColor, uSurfaceColor, vElevation * 0.1 + 0.5);
    
    // Add caustics
    color += vec3(0.6, 0.9, 1.0) * caustics * 0.5;
    
    // Edge fade
    float dist = length(vUv - 0.5) * 2.0;
    float alpha = 1.0 - smoothstep(0.8, 1.0, dist);
    
    gl_FragColor = vec4(color, alpha * 0.8);
}
`;

// ═══════════════════════════════════════════════════════════════════════════════
// GOD RAYS SHADER - Enhanced volumetric look
// ═══════════════════════════════════════════════════════════════════════════════

const godRayVertexShader = `
varying vec2 vUv;
varying vec3 vPos;
varying float vDepth;

void main() {
    vUv = uv;
    vPos = position;
    
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mvPos.z;
    
    gl_Position = projectionMatrix * mvPos;
}
`;

const godRayFragmentShader = `
uniform float uTime;
varying vec2 vUv;
varying vec3 vPos;
varying float vDepth;

${noiseGLSL}

void main() {
    // Vertical fade - stronger at top, fading to bottom
    float verticalFade = pow(1.0 - vUv.y, 0.8);
    
    // Volumetric noise for light scattering effect
    vec3 noisePos = vec3(vPos.x * 0.05, vPos.y * 0.02 + uTime * 0.1, vPos.z * 0.05);
    float volumeNoise = snoise(noisePos) * 0.5 + 0.5;
    float detailNoise = snoise(noisePos * 3.0 + uTime * 0.05) * 0.3;
    
    // Combine for ethereal look
    float volume = volumeNoise + detailNoise * 0.3;
    
    // Soft edge fade (center to edges)
    float edgeFade = 1.0 - pow(abs(vUv.x - 0.5) * 2.0, 2.0);
    
    // Shimmer animation
    float shimmer = sin(vPos.y * 0.3 + uTime * 2.0) * 0.15 + 0.85;
    
    // Combine all fades
    float alpha = verticalFade * edgeFade * volume * shimmer * 0.4;
    
    // Beautiful cyan-blue color gradient
    vec3 topColor = vec3(0.6, 0.95, 1.0);   // Bright cyan
    vec3 bottomColor = vec3(0.2, 0.5, 0.8); // Deep blue
    vec3 color = mix(bottomColor, topColor, verticalFade);
    
    // Add slight warm tint near edges
    color += vec3(0.1, 0.05, 0.0) * (1.0 - edgeFade) * 0.3;
    
    gl_FragColor = vec4(color, alpha);
}
`;

// ═══════════════════════════════════════════════════════════════════════════════
// ENVIRONMENT CREATION
// ═══════════════════════════════════════════════════════════════════════════════

export function createDeepOceanEnvironment(options = {}) {
    const group = new THREE.Group();
    group.name = 'deep-ocean-environment';
    group.userData.chapterId = 2;
    group.userData.yStart = DEEP_OCEAN_CONFIG.yStart;
    group.userData.yEnd = DEEP_OCEAN_CONFIG.yEnd;

    const uniforms = { uTime: { value: 0 } };
    group.userData.uniforms = uniforms;

    const chapterRange = getChapterPathRange(2);
    const fallbackCenterY = (DEEP_OCEAN_CONFIG.yStart + DEEP_OCEAN_CONFIG.yEnd) / 2;
    const chapterCenterY = chapterRange?.center.y ?? fallbackCenterY;
    const surfaceOffsetY = chapterRange
        ? chapterRange.end.y - chapterCenterY
        : 20;

    if (chapterRange) {
        group.userData.yStart = chapterRange.start.y;
        group.userData.yEnd = chapterRange.end.y;
    }

    // 1. Ocean Gradient Background
    const oceanGradient = createOceanGradient(uniforms);
    group.add(oceanGradient);

    // 2. Water Surface (Looking up) - [NEW]
    const waterSurface = createWaterSurface(uniforms, surfaceOffsetY);
    group.add(waterSurface);

    // 3. Volumetric God Rays - Enhanced
    const rays = createGodRays(uniforms);
    group.add(rays);

    // 4. Bioluminescent Jellyfish (reduced count for cleaner look)
    const jellyfishCount = Math.floor((options.particleCount || 500) / 25); // Fewer jellyfish
    const jellyfish = createBioluminescentJellyfish(uniforms, jellyfishCount);
    group.add(jellyfish);

    // 5. Bubbles
    const bubbles = createBubbleParticles(uniforms, options.particleCount || 400);
    group.add(bubbles);

    // 6. Plankton
    const plankton = createPlanktonParticles(uniforms, options.particleCount || 600);
    group.add(plankton);

    // Position group center
    group.position.y = chapterCenterY;
    group.userData.waterSurfaceY = chapterCenterY + surfaceOffsetY;

    return group;
}

function createOceanGradient(uniforms) {
    const geometry = new THREE.SphereGeometry(280, 48, 48); // High quality sphere
    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: uniforms.uTime,
            uColorTop: { value: new THREE.Color(0x004466) },
            uColorMid: { value: new THREE.Color(0x001530) },
            uColorBottom: { value: new THREE.Color(0x000510) },
            uOpacity: { value: 1.0 },
        },
        vertexShader: `
            varying vec3 vPosition;
            void main() {
                vPosition = position;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float uTime;
            uniform vec3 uColorTop;
            uniform vec3 uColorMid;
            uniform vec3 uColorBottom;
            uniform float uOpacity;
            varying vec3 vPosition;
            
            void main() {
                // Sphere mapping -1 to 1
                float t = normalize(vPosition).y;
                
                vec3 color;
                if(t > 0.0) {
                    color = mix(uColorMid, uColorTop, t);
                } else {
                    color = mix(uColorMid, uColorBottom, -t);
                }
                
                gl_FragColor = vec4(color, uOpacity);
            }
        `,
        side: THREE.BackSide,
        depthWrite: false,
        transparent: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = -100;
    return mesh;
}

function createWaterSurface(uniforms, surfaceOffsetY = 20) {
    // Plane geometry for water surface overhead
    const geometry = new THREE.PlaneGeometry(300, 300, 64, 64);
    geometry.rotateX(Math.PI / 2); // Horizontal

    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: uniforms.uTime,
            uSurfaceColor: { value: new THREE.Color(0x007799) },
            uDeepColor: { value: new THREE.Color(0x003355) },
        },
        vertexShader: waterVertexShader,
        fragmentShader: waterFragmentShader,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false, // Don't occlude particles behind it if viewed from weird angle
        blending: THREE.AdditiveBlending, // Glowy look from below
    });

    const mesh = new THREE.Mesh(geometry, material);
    // Position at top of chapter bounds (relative to center is +15, since height is 30)
    // Actually we want it slightly above to be the "ceiling"
    mesh.position.y = surfaceOffsetY;
    return mesh;
}

function createGodRays(uniforms) {
    const group = new THREE.Group();
    group.name = 'god-rays';

    // Use tapered cone for more realistic light shaft
    const geometry = new THREE.ConeGeometry(12, 100, 24, 8, true);
    geometry.translate(0, -50, 0); // Pivot at top

    const material = new THREE.ShaderMaterial({
        uniforms: { uTime: uniforms.uTime },
        vertexShader: godRayVertexShader,
        fragmentShader: godRayFragmentShader,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    // Fewer, cleaner rays
    const rayCount = 5;
    for (let i = 0; i < rayCount; i++) {
        const ray = new THREE.Mesh(geometry, material);

        // Spread evenly across the scene
        const angle = (i / rayCount) * Math.PI * 0.8 - Math.PI * 0.4; // Spread in front
        const radius = 30 + i * 20;
        ray.position.x = Math.sin(angle) * radius;
        ray.position.z = -40 - i * 15;
        ray.position.y = 25; // Start from top

        // Very slight tilt
        ray.rotation.z = (i - 2) * 0.08;
        ray.rotation.x = -0.05;

        // Thinner rays
        const scale = 0.4 + i * 0.1;
        ray.scale.set(scale, 1.0, scale);

        group.add(ray);
    }
    return group;
}

function createBioluminescentJellyfish(uniforms, count) {
    const group = new THREE.Group();
    group.name = 'jellyfish-group';

    // Create glow texture for bioluminescent effect
    const glowTexture = createJellyfishGlowTexture();

    // Jellyfish colors - soft bioluminescent palette
    const jellyColors = [
        0x00ffff, // Cyan
        0x00aaff, // Light blue
        0xff88ff, // Pink
        0x88ffaa, // Soft green
        0xaaddff, // Pale blue
    ];

    for (let i = 0; i < count; i++) {
        const jellyGroup = new THREE.Group();

        // Random color from palette
        const color = jellyColors[Math.floor(Math.random() * jellyColors.length)];
        const size = 0.8 + Math.random() * 1.5;

        // Jellyfish body - semi-transparent dome
        const bodyGeo = new THREE.SphereGeometry(size, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.6);
        const bodyMat = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.4,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        // Dome faces UP (natural jellyfish orientation)
        jellyGroup.add(body);

        // Inner glow core
        const coreGeo = new THREE.SphereGeometry(size * 0.5, 16, 12);
        const coreMat = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        const core = new THREE.Mesh(coreGeo, coreMat);
        core.position.y = -size * 0.1; // Core slightly inside dome
        jellyGroup.add(core);

        // Glow sprite for ambient light
        const glowSprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: glowTexture,
            color,
            transparent: true,
            opacity: 0.5,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        }));
        glowSprite.scale.set(size * 4, size * 4, 1);
        jellyGroup.add(glowSprite);

        // Position in the scene
        jellyGroup.position.set(
            (Math.random() - 0.5) * 120,
            (Math.random() - 0.5) * 35,
            -15 - Math.random() * 70,
        );

        jellyGroup.userData = {
            t: Math.random() * 100,
            speed: 0.3 + Math.random() * 0.4,
            pulsePhase: Math.random() * Math.PI * 2,
            baseScale: size,
        };

        group.add(jellyGroup);
    }
    return group;
}

/**
 * Create glow texture for jellyfish
 */
function createJellyfishGlowTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    gradient.addColorStop(0.2, 'rgba(200, 255, 255, 0.6)');
    gradient.addColorStop(0.5, 'rgba(100, 200, 255, 0.2)');
    gradient.addColorStop(1, 'rgba(0, 100, 150, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);

    return new THREE.CanvasTexture(canvas);
}

// Reuse simple particles
function createBubbleParticles(uniforms, count) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const speed = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        pos[i * 3] = (Math.random() - 0.5) * 120;
        pos[i * 3 + 1] = (Math.random() - 0.5) * 40;
        pos[i * 3 + 2] = -10 - Math.random() * 50;
        speed[i] = 1.0 + Math.random() * 3.0;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('speed', new THREE.BufferAttribute(speed, 1));

    // Create circular bubble texture
    const bubbleTexture = createCircularTexture(0.9, 0.3);

    const mat = new THREE.PointsMaterial({
        map: bubbleTexture,
        color: 0xaaddff,
        size: 0.8,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
    });

    const points = new THREE.Points(geo, mat);
    points.name = 'bubbles';
    return points;
}

/**
 * Create circular glow texture for particles
 */
function createCircularTexture(innerOpacity = 1.0, outerOpacity = 0) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, `rgba(255, 255, 255, ${innerOpacity})`);
    gradient.addColorStop(0.4, `rgba(200, 230, 255, ${innerOpacity * 0.7})`);
    gradient.addColorStop(0.7, `rgba(150, 200, 255, ${outerOpacity * 2})`);
    gradient.addColorStop(1, 'rgba(100, 150, 200, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);

    return new THREE.CanvasTexture(canvas);
}

function createPlanktonParticles(uniforms, count) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const colors = new Float32Array(count * 3);

    // Bioluminescent plankton colors
    const planktonColors = [
        new THREE.Color(0x00ffaa), // Cyan-green
        new THREE.Color(0x00ddff), // Light blue
        new THREE.Color(0x88ffcc), // Soft green
        new THREE.Color(0xaaffff), // Pale cyan
    ];

    for (let i = 0; i < count; i++) {
        pos[i * 3] = (Math.random() - 0.5) * 150;
        pos[i * 3 + 1] = (Math.random() - 0.5) * 50;
        pos[i * 3 + 2] = -10 - Math.random() * 70;

        // Random sizes
        sizes[i] = 0.15 + Math.random() * 0.3;

        // Random color from palette
        const color = planktonColors[Math.floor(Math.random() * planktonColors.length)];
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // Create circular plankton texture
    const planktonTexture = createCircularTexture(1.0, 0.1);

    const mat = new THREE.PointsMaterial({
        map: planktonTexture,
        size: 0.4,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        vertexColors: true,
        sizeAttenuation: true,
        depthWrite: false,
    });

    const points = new THREE.Points(geo, mat);
    points.name = 'plankton';
    return points;
}

export function updateDeepOceanEnvironment(group, delta, time) {
    const { uniforms } = group.userData;
    if (uniforms?.uTime) {
        uniforms.uTime.value = time;
    }

    // Update jellies with pulsing animation
    const jellies = group.getObjectByName('jellyfish-group');
    if (jellies) {
        jellies.children.forEach((j) => {
            const { userData } = j;

            // Gentle floating motion
            j.position.y += Math.sin(time * userData.speed + userData.t) * delta * 0.5;
            j.position.x += Math.cos(time * 0.3 + userData.t) * delta * 0.3;
            j.position.z += Math.sin(time * 0.2 + userData.t * 0.5) * delta * 0.2;

            // Pulsing scale animation (gentle breathing effect)
            const pulse = 1 + Math.sin(time * 1.5 + userData.pulsePhase) * 0.1;
            j.scale.setScalar(pulse);
        });
    }

    // Update bubbles
    const bubbles = group.getObjectByName('bubbles');
    if (bubbles) {
        const pos = bubbles.geometry.attributes.position.array;
        const speed = bubbles.geometry.attributes.speed.array;

        for (let i = 0; i < speed.length; i++) {
            pos[i * 3 + 1] += speed[i] * delta;
            if (pos[i * 3 + 1] > 20) pos[i * 3 + 1] = -20;
        }
        bubbles.geometry.attributes.position.needsUpdate = true;
    }
}

export default {
    config: DEEP_OCEAN_CONFIG,
    create: createDeepOceanEnvironment,
    update: updateDeepOceanEnvironment,
};
