/**
 * @fileoverview Cosmic Expanse Environment - Chapter 6 Visual Theme
 *
 * Creates a deep-space vista dominated by a volumetric black hole, a hero gas
 * giant, and a layered nebula. Part of the Odyssey AAA "Cosmic Ascent" overhaul
 * (Phase 4 — chapter level-up); see docs/ODYSSEY_MODE_AAA_OVERHAUL_PLAN.md §5.
 *
 * Layers (plan §3.2):
 *   0  Nebula void dome      — FBM galactic backdrop, not a flat black sphere
 *   1  Hero anchor           — volumetric black hole: shader accretion disk
 *                              (swirling plasma + Doppler asymmetry), photon ring,
 *                              fresnel gravitational-lensing shell
 *   1b Hero planet           — banded gas giant with storm bands + atmosphere rim
 *   2  Mid environment       — nebula volume points, distant accretion glow
 *   6  Near life             — twinkling starfield + matter spiralling into the void
 *
 * All glow is GLSL-procedural (gl_PointCoord / fresnel) so create() never needs a
 * `document`/canvas and stays safe in headless tests.
 *
 * Theme: "Journey through stars" -> "The event horizon awaits"
 */

import * as THREE from 'three';
import { ODYSSEY_NOISE_GLSL } from './shared/odyssey-noise.js';
import { getChapterPathRange } from '../path-utils.js';

/**
 * Cosmic Expanse environment configuration
 */
export const COSMIC_EXPANSE_CONFIG = {
    id: 6,
    name: 'cosmic-expanse',
    yStart: 297.5,
    yEnd: 430.0,
    colors: {
        primary: 0x0a0a0a, // Void black
        secondary: 0x1a1a2e, // Deep blue-black
        tertiary: 0xff3300, // Accretion orange
        accent: 0x4400cc, // Event horizon purple
        background: 0x000000, // Pure black
    },
};

// ═══════════════════════════════════════════════════════════════════════════════
// GLSL Shaders
// ═══════════════════════════════════════════════════════════════════════════════

// Nebula void dome — deep indigo base + drifting galactic cloud bands.
const voidVertexShader = /* glsl */ `
    varying vec3 vDir;
    void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const voidFragmentShader = /* glsl */ `
    uniform float uTime;
    uniform float uEnergy;
    varying vec3 vDir;

    ${ODYSSEY_NOISE_GLSL}

    void main() {
        vec3 dir = normalize(vDir);
        float h = dir.y * 0.5 + 0.5;

        // Deep space vertical gradient (near-black, faint indigo toward the top).
        vec3 base = mix(vec3(0.004, 0.004, 0.012), vec3(0.02, 0.012, 0.05), h);

        // Galactic band: a tilted plane of denser stars/dust across the sphere.
        float band = exp(-pow(dot(dir, normalize(vec3(0.4, 0.18, 1.0))) , 2.0) * 6.0);
        vec3 q = dir * 3.2 + vec3(0.0, 0.0, uTime * 0.02);
        float dust = fbm3(q);
        float filaments = ridged3(q * 0.7 + 13.0);

        vec3 nebula = vec3(0.10, 0.05, 0.22) * dust;
        nebula += vec3(0.16, 0.07, 0.10) * filaments * band;
        nebula += vec3(0.05, 0.10, 0.20) * band * 0.6;

        vec3 color = base + nebula * (0.5 + uEnergy * 0.4);
        gl_FragColor = vec4(color, 1.0);
    }
`;

// Accretion disk — swirling Keplerian plasma with Doppler beaming.
const accretionVertexShader = /* glsl */ `
    varying float vRadius;
    varying float vAngle;
    varying vec2 vLocal;
    void main() {
        vLocal = position.xy;
        vRadius = length(position.xy);
        vAngle = atan(position.y, position.x);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const accretionFragmentShader = /* glsl */ `
    uniform float uTime;
    uniform float uEnergy;
    uniform float uInner;
    uniform float uOuter;
    uniform vec3 uHot;
    uniform vec3 uMid;
    uniform vec3 uCool;
    varying float vRadius;
    varying float vAngle;
    varying vec2 vLocal;

    ${ODYSSEY_NOISE_GLSL}

    void main() {
        float t = clamp((vRadius - uInner) / (uOuter - uInner), 0.0, 1.0);

        // Differential rotation: inner orbits faster than outer (Keplerian feel).
        float swirl = vAngle + uTime * (0.55 + (1.0 - t) * 1.6);
        vec3 sp = vec3(cos(swirl), sin(swirl), 0.0) * (0.6 + t * 3.0);
        float turb = fbm3(sp * 1.6 + vec3(0.0, 0.0, uTime * 0.12));
        float streaks = 0.5 + 0.5 * sin(swirl * 3.0 + t * 16.0 - uTime * 1.1);
        float plasma = mix(turb, streaks, 0.4);

        // Radial profile: bright just outside the horizon, soft outer falloff.
        float radial = smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.5, 1.0, t));

        // Doppler beaming: the side rotating toward the camera is brighter/bluer.
        float doppler = 0.55 + 0.7 * smoothstep(-uOuter, uOuter, vLocal.x);

        float intensity = radial * (0.3 + plasma * 0.95) * doppler;
        intensity *= 1.0 + uEnergy * 0.55;

        vec3 color = mix(uHot, uMid, smoothstep(0.0, 0.4, t));
        color = mix(color, uCool, smoothstep(0.4, 1.0, t));
        color += vec3(0.15, 0.18, 0.30) * doppler * radial; // blue-shift highlight

        gl_FragColor = vec4(color * intensity, intensity);
    }
`;

// Gravitational-lensing shell — fresnel glow that rings the horizon.
const lensVertexShader = /* glsl */ `
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
    }
`;

const lensFragmentShader = /* glsl */ `
    uniform float uTime;
    uniform vec3 uColor;
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
        float fres = pow(1.0 - max(0.0, dot(vNormal, vView)), 3.0);
        float ring = smoothstep(0.35, 0.95, fres);
        float shimmer = 0.85 + 0.15 * sin(uTime * 1.4 + fres * 12.0);
        gl_FragColor = vec4(uColor * ring * shimmer, ring * 0.5);
    }
`;

// Gas-giant hero planet — latitudinal storm bands + day/night + atmosphere rim.
const planetVertexShader = /* glsl */ `
    varying vec3 vNormal;
    varying vec3 vView;
    varying vec3 vPos;
    void main() {
        vNormal = normalize(normalMatrix * normal);
        vPos = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
    }
`;

const planetFragmentShader = /* glsl */ `
    uniform float uTime;
    uniform vec3 uColor1;
    uniform vec3 uColor2;
    uniform vec3 uLightDir;
    varying vec3 vNormal;
    varying vec3 vView;
    varying vec3 vPos;

    ${ODYSSEY_NOISE_GLSL}

    void main() {
        vec3 n = normalize(vPos);
        // Banded latitudes warped by turbulence -> storm bands.
        float bands = sin(n.y * 11.0 + fbm3(n * 2.4 + uTime * 0.04) * 4.0);
        float storm = fbm3(n * 5.0 + vec3(uTime * 0.05, 0.0, 0.0));
        float mixv = clamp(bands * 0.5 + 0.5 + (storm - 0.5) * 0.4, 0.0, 1.0);
        vec3 color = mix(uColor2, uColor1, mixv);

        // Day / night terminator.
        float diffuse = max(0.0, dot(vNormal, normalize(uLightDir)));
        color *= 0.18 + diffuse * 0.95;

        // Atmosphere rim.
        float fres = pow(1.0 - max(0.0, dot(vNormal, vView)), 2.4);
        color += vec3(0.28, 0.42, 0.85) * fres * (0.4 + diffuse * 0.6);

        gl_FragColor = vec4(color, 1.0);
    }
`;

// Twinkling starfield.
const starVertexShader = /* glsl */ `
    uniform float uTime;
    attribute float aSize;
    attribute float aTwinkle;
    attribute vec3 aColor;
    varying float vAlpha;
    varying vec3 vColor;
    void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float twinkle = 0.55 + 0.45 * sin(uTime * 1.8 + aTwinkle);
        gl_PointSize = aSize * twinkle * (240.0 / -mv.z);
        gl_PointSize = clamp(gl_PointSize, 0.6, 5.0);
        vAlpha = twinkle;
        vColor = aColor;
    }
`;

const starFragmentShader = /* glsl */ `
    varying float vAlpha;
    varying vec3 vColor;
    void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float glow = pow(1.0 - d * 2.0, 1.6);
        gl_FragColor = vec4(vColor, glow * vAlpha);
    }
`;

// Soft nebula volume points.
const nebulaVertexShader = /* glsl */ `
    uniform float uTime;
    attribute float aSize;
    attribute float aPhase;
    attribute vec3 aColor;
    varying float vAlpha;
    varying vec3 vColor;
    void main() {
        vec3 p = position;
        p.x += sin(uTime * 0.05 + aPhase) * 6.0;
        p.y += cos(uTime * 0.04 + aPhase) * 4.0;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * (520.0 / -mv.z);
        gl_PointSize = clamp(gl_PointSize, 4.0, 90.0);
        vAlpha = 0.16 + 0.08 * sin(uTime * 0.3 + aPhase);
        vColor = aColor;
    }
`;

const nebulaFragmentShader = /* glsl */ `
    varying float vAlpha;
    varying vec3 vColor;
    void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float glow = pow(1.0 - d * 2.0, 2.2);
        gl_FragColor = vec4(vColor, glow * vAlpha);
    }
`;

// Particle suction shader (matter spiralling into the void).
const suctionVertexShader = /* glsl */ `
    uniform float uTime;
    attribute float aPhase;
    attribute float aSpeed;
    attribute float aRadius;
    varying float vAlpha;
    varying vec3 vColor;

    void main() {
        float t = mod(uTime * aSpeed + aPhase, 10.0);
        float progress = 1.0 - (t / 10.0); // 1.0 (start) -> 0.0 (center)

        float r = aRadius * progress;
        float angle = aPhase + progress * 24.0;

        vec3 pos = position;
        pos.x = cos(angle) * r;
        pos.y = sin(angle) * r * 0.32;
        pos.z = position.z + (1.0 - progress) * 6.0;

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = (2.0 + progress * 2.0) * (220.0 / -mvPosition.z);

        vAlpha = progress;
        // Redshift as it falls in.
        vColor = mix(vec3(0.45, 0.65, 1.0), vec3(1.0, 0.3, 0.12), 1.0 - progress);
    }
`;

const suctionFragmentShader = /* glsl */ `
    varying float vAlpha;
    varying vec3 vColor;
    void main() {
        float dist = length(gl_PointCoord - 0.5);
        if (dist > 0.5) discard;
        float glow = pow(1.0 - dist * 2.0, 1.4);
        gl_FragColor = vec4(vColor, vAlpha * glow);
    }
`;

// ═══════════════════════════════════════════════════════════════════════════════
// Environment Creation
// ═══════════════════════════════════════════════════════════════════════════════

export function createCosmicExpanseEnvironment(options = {}) {
    const group = new THREE.Group();
    group.name = 'cosmic-expanse-environment';
    group.userData.chapterId = 6;
    group.userData.yStart = COSMIC_EXPANSE_CONFIG.yStart;
    group.userData.yEnd = COSMIC_EXPANSE_CONFIG.yEnd;
    const chapterRange = getChapterPathRange(6);
    const fallbackCenterY = (COSMIC_EXPANSE_CONFIG.yStart + COSMIC_EXPANSE_CONFIG.yEnd) / 2;
    const chapterCenterY = chapterRange?.center.y ?? fallbackCenterY;
    if (chapterRange) {
        group.userData.yStart = chapterRange.start.y;
        group.userData.yEnd = chapterRange.end.y;
    }

    const uniforms = {
        uTime: { value: 0 },
        uEnergy: { value: 0.3 },
    };
    group.userData.uniforms = uniforms;

    const particleCount = options.particleCount || 1000;

    // 0. Nebula void dome
    const voidSky = createVoidSky(uniforms);
    group.add(voidSky);

    // 1. The black hole — looming directly ahead, tilted toward the camera.
    const blackHole = createBlackHole(uniforms);
    blackHole.position.set(0, 0, -800);
    blackHole.rotation.x = -1.12;
    blackHole.scale.setScalar(1.5);
    group.add(blackHole);
    group.userData.blackHole = blackHole;

    // 1b. Hero gas giant
    const heroPlanet = createHeroPlanet(uniforms);
    group.add(heroPlanet);
    group.userData.heroPlanet = heroPlanet;

    // 2. Matter spiralling into the void (aligned to the disk plane).
    const debris = createSuctionParticles(uniforms, particleCount);
    debris.position.set(0, 0, -800);
    debris.rotation.x = -1.12;
    debris.scale.setScalar(1.5);
    group.add(debris);

    // 6. Twinkling starfield
    const stars = createVoidStars(uniforms, Math.max(64, particleCount * 2));
    group.add(stars);

    // 2b. Nebula volume points
    const nebulaVolume = createNebulaVolume(uniforms, Math.max(48, Math.floor(particleCount * 0.7)));
    group.add(nebulaVolume);
    group.userData.nebulaVolume = nebulaVolume;

    // Lighting (ominous accretion key)
    setupCosmicLighting(group);

    group.position.y = chapterCenterY;

    return group;
}

function createVoidSky(uniforms) {
    const geometry = new THREE.SphereGeometry(420, 48, 32);
    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: uniforms.uTime,
            uEnergy: uniforms.uEnergy,
        },
        vertexShader: voidVertexShader,
        fragmentShader: voidFragmentShader,
        side: THREE.BackSide,
        depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = -100;
    return mesh;
}

function createBlackHole(uniforms) {
    const group = new THREE.Group();
    group.name = 'volumetric-black-hole-anchor';

    // Event horizon — a perfectly dark, slightly oblate sphere.
    const horizon = new THREE.Mesh(
        new THREE.SphereGeometry(24, 48, 32),
        new THREE.MeshBasicMaterial({ color: 0x000000 }),
    );
    horizon.scale.set(1.0, 1.0, 0.9);
    group.add(horizon);

    // Shader accretion disk (the dominant feature).
    const disk = new THREE.Mesh(
        new THREE.RingGeometry(28, 96, 240, 6),
        new THREE.ShaderMaterial({
            uniforms: {
                uTime: uniforms.uTime,
                uEnergy: uniforms.uEnergy,
                uInner: { value: 28 },
                uOuter: { value: 96 },
                uHot: { value: new THREE.Color(0xffe7b0) },
                uMid: { value: new THREE.Color(0xff6b22) },
                uCool: { value: new THREE.Color(0x7a3cff) },
            },
            vertexShader: accretionVertexShader,
            fragmentShader: accretionFragmentShader,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        }),
    );
    disk.name = 'accretion-disk';
    group.add(disk);

    // Photon ring — thin bright ring hugging the horizon, in the disk plane.
    const photonRing = new THREE.Mesh(
        new THREE.RingGeometry(25.5, 28.5, 160, 1),
        new THREE.MeshBasicMaterial({
            color: 0xfff0c0,
            transparent: true,
            opacity: 0.85,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        }),
    );
    group.add(photonRing);

    // Two coplanar additive glow rings to feed bloom and add depth.
    [0, 1].forEach((index) => {
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(40 + index * 22, 70 + index * 30, 96, 1),
            new THREE.MeshBasicMaterial({
                color: index === 0 ? 0xff7b3a : 0x7f3cff,
                transparent: true,
                opacity: 0.12 - index * 0.04,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            }),
        );
        group.add(ring);
    });

    // Gravitational-lensing fresnel shell.
    const lensShell = new THREE.Mesh(
        new THREE.SphereGeometry(30, 48, 32),
        new THREE.ShaderMaterial({
            uniforms: {
                uTime: uniforms.uTime,
                uColor: { value: new THREE.Color(0x9bbcff) },
            },
            vertexShader: lensVertexShader,
            fragmentShader: lensFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.FrontSide,
        }),
    );
    lensShell.name = 'lensing-shell';
    group.add(lensShell);

    group.userData.uniforms = uniforms;
    return group;
}

function createHeroPlanet(uniforms) {
    const group = new THREE.Group();
    group.name = 'hero-planet-nebula-anchor';
    group.position.set(-145, 72, -720);

    const planet = new THREE.Mesh(
        new THREE.SphereGeometry(28, 64, 48),
        new THREE.ShaderMaterial({
            uniforms: {
                uTime: uniforms.uTime,
                uColor1: { value: new THREE.Color(0x4a73b8) },
                uColor2: { value: new THREE.Color(0x12182e) },
                uLightDir: { value: new THREE.Vector3(0.7, 0.3, 0.6).normalize() },
            },
            vertexShader: planetVertexShader,
            fragmentShader: planetFragmentShader,
        }),
    );
    group.add(planet);
    group.userData.planet = planet;

    // Atmosphere halo.
    const atmosphere = new THREE.Mesh(
        new THREE.SphereGeometry(31, 48, 32),
        new THREE.MeshBasicMaterial({
            color: 0x6c9dff,
            transparent: true,
            opacity: 0.12,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.BackSide,
        }),
    );
    group.add(atmosphere);

    // Ring system.
    const ring = new THREE.Mesh(
        new THREE.RingGeometry(38, 54, 96),
        new THREE.MeshBasicMaterial({
            color: 0x8fb0ff,
            transparent: true,
            opacity: 0.2,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            depthWrite: false,
        }),
    );
    ring.rotation.x = Math.PI * 0.42;
    group.add(ring);

    return group;
}

function createNebulaVolume(uniforms, count) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const palette = [
        new THREE.Color(0x6633ff),
        new THREE.Color(0x2f6bff),
        new THREE.Color(0xff5fb0),
        new THREE.Color(0xffa14a),
    ];

    for (let index = 0; index < count; index += 1) {
        const stride = index * 3;
        positions[stride] = (Math.random() - 0.5) * 460;
        positions[stride + 1] = (Math.random() - 0.5) * 260;
        positions[stride + 2] = -560 - Math.random() * 360;

        const color = palette[index % palette.length];
        colors[stride] = color.r;
        colors[stride + 1] = color.g;
        colors[stride + 2] = color.b;

        sizes[index] = 26 + Math.random() * 70;
        phases[index] = Math.random() * Math.PI * 2;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

    const points = new THREE.Points(
        geometry,
        new THREE.ShaderMaterial({
            uniforms: { uTime: uniforms.uTime },
            vertexShader: nebulaVertexShader,
            fragmentShader: nebulaFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        }),
    );
    points.name = 'nebula-volume-points';
    return points;
}

function createSuctionParticles(uniforms, count) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const speeds = new Float32Array(count);
    const radii = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        positions[i * 3] = 0;
        positions[i * 3 + 1] = 0;
        positions[i * 3 + 2] = 0;

        phases[i] = Math.random() * Math.PI * 2;
        speeds[i] = 0.5 + Math.random() * 1.5;
        radii[i] = 30 + Math.random() * 55;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
    geometry.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));

    const material = new THREE.ShaderMaterial({
        uniforms: { uTime: uniforms.uTime },
        vertexShader: suctionVertexShader,
        fragmentShader: suctionFragmentShader,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geometry, material);
    points.name = 'suction-particles';
    return points;
}

function createVoidStars(uniforms, count) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const twinkles = new Float32Array(count);
    const colors = new Float32Array(count * 3);

    const starPalette = [
        new THREE.Color(0xffffff),
        new THREE.Color(0xbcd0ff),
        new THREE.Color(0xfff0cf),
        new THREE.Color(0xd6b8ff),
    ];

    for (let i = 0; i < count; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = 200 + Math.random() * 120;
        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.cos(phi);
        positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
        sizes[i] = 0.8 + Math.random() * 2.4;
        twinkles[i] = Math.random() * Math.PI * 2;

        const color = starPalette[Math.floor(Math.random() * starPalette.length)];
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkles, 1));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.ShaderMaterial({
        uniforms: { uTime: uniforms.uTime },
        vertexShader: starVertexShader,
        fragmentShader: starFragmentShader,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geometry, material);
    points.name = 'void-stars';
    return points;
}

function setupCosmicLighting(group) {
    group.add(new THREE.AmbientLight(0x141425, 0.5));

    const diskLight = new THREE.PointLight(0xff6a2a, 1.1, 600);
    diskLight.position.set(0, 18, -640);
    group.add(diskLight);
    group.userData.diskLight = diskLight;

    const rimLight = new THREE.DirectionalLight(0x6a4cff, 0.4);
    rimLight.position.set(-60, 50, -200);
    group.add(rimLight);
}

export function updateCosmicExpanseEnvironment(group, delta, time, ...updateArgs) {
    const [, , directorState = null] = updateArgs;
    const { uniforms } = group.userData;
    if (uniforms?.uTime) {
        uniforms.uTime.value = time;
    }
    // Autonomous energy breath (Phase 6 will drive this from the audio reactor).
    if (uniforms?.uEnergy) {
        const audioEnergy = directorState
            ? THREE.MathUtils.clamp((directorState.energy || 0) * 0.72 + (directorState.bass || 0) * 0.28, 0, 1)
            : null;
        uniforms.uEnergy.value = audioEnergy === null
            ? 0.32 + Math.sin(time * 0.5) * 0.16
            : 0.24 + audioEnergy * 0.64 + (directorState.beatPulse || 0) * 0.08;
    }

    const { blackHole } = group.userData;
    if (blackHole) {
        // Subtle precession of the whole assembly.
        blackHole.rotation.z -= delta * 0.04;
    }

    const { heroPlanet } = group.userData;
    if (heroPlanet) {
        heroPlanet.rotation.y += delta * 0.025;
        heroPlanet.rotation.z = Math.sin(time * 0.08) * 0.025;
    }

    const { nebulaVolume } = group.userData;
    if (nebulaVolume) {
        nebulaVolume.rotation.y += delta * 0.006;
    }

    const { diskLight } = group.userData;
    if (diskLight) {
        diskLight.intensity = 1.0 + Math.sin(time * 0.7) * 0.25 + (uniforms?.uEnergy?.value ?? 0) * 0.4;
    }
}

export default {
    config: COSMIC_EXPANSE_CONFIG,
    create: createCosmicExpanseEnvironment,
    update: updateCosmicExpanseEnvironment,
};
