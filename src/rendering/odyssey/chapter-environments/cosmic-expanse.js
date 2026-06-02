/**
 * @fileoverview Cosmic Expanse Environment - Chapter 6 Visual Theme
 *
 * Creates a deep space environment dominated by a massive black hole.
 * Features:
 * - Event Horizon with gravitational distortion (simulated)
 * - Accretion Disk with swirling plasma
 * - Void-like atmosphere with dense starfields
 * - Particles being sucked into the void
 *
 * Theme: "Journey through stars" -> "The event horizon awaits"
 */

import * as THREE from 'three';

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

// Simple void gradient
const voidVertexShader = `
    varying vec3 vPosition;
    void main() {
        vPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const voidFragmentShader = `
    varying vec3 vPosition;
    void main() {
        // Pure black to very deep purple gradient
        float t = (normalize(vPosition).y + 1.0) * 0.5;
        vec3 bottom = vec3(0.0, 0.0, 0.0);
        vec3 top = vec3(0.01, 0.01, 0.03);
        gl_FragColor = vec4(mix(bottom, top, t), 1.0);
    }
`;

// Particle suction shader
const suctionVertexShader = `
    uniform float uTime;
    attribute float aPhase;
    attribute float aSpeed;
    attribute float aRadius;
    varying float vAlpha;
    varying vec3 vColor;
    
    void main() {
        // Spiral motion towards center
        float t = mod(uTime * aSpeed + aPhase, 10.0);
        float progress = 1.0 - (t / 10.0); // 1.0 (start) -> 0.0 (center)
        
        float r = aRadius * progress; // Shrink radius
        float angle = aPhase + progress * 20.0; // Spin faster as getting closer
        
        vec3 pos = position;
        pos.x = cos(angle) * r;
        pos.y = sin(angle) * r * 0.3; // Flattened disk
        pos.z = position.z + (1.0 - progress) * 5.0; // Slight Z pull
        
        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        
        gl_PointSize = (2.0 + progress * 2.0) * (200.0 / -mvPosition.z);
        
        vAlpha = progress; // Fade out near center
        
        // Color shift from blue to red as it falls in (redshift)
        vColor = mix(vec3(0.2, 0.4, 1.0), vec3(1.0, 0.2, 0.1), 1.0 - progress);
    }
`;

const suctionFragmentShader = `
    varying float vAlpha;
    varying vec3 vColor;
    void main() {
        float dist = length(gl_PointCoord - 0.5);
        if (dist > 0.5) discard;
        gl_FragColor = vec4(vColor, vAlpha);
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

    const uniforms = { uTime: { value: 0 } };
    group.userData.uniforms = uniforms;

    // 1. Void Background
    const voidSky = createVoidSky(uniforms);
    group.add(voidSky);

    // 2. The Black Hole - Moved deep ahead of path (z=-800)
    const blackHole = createBlackHole(uniforms);
    blackHole.position.set(0, 0, -800); // Looming directly ahead
    blackHole.rotation.x = -0.3; // Tilted disk
    // Scale up slightly to be more imposing at distance
    blackHole.scale.setScalar(1.5);
    group.add(blackHole);
    group.userData.blackHole = blackHole;

    const heroPlanet = createHeroPlanet();
    group.add(heroPlanet);
    group.userData.heroPlanet = heroPlanet;

    // 3. Suction Particles (Matter falling in)
    const debris = createSuctionParticles(uniforms, options.particleCount || 1000);
    debris.position.set(0, 0, -800); // Centered on Black Hole
    debris.rotation.x = -0.3;
    debris.scale.setScalar(1.5);
    group.add(debris);

    // 4. Distant "Stellar Velocity" Stars
    const stars = createVoidStars(uniforms, 2000);
    group.add(stars);

    const nebulaVolume = createNebulaVolume(options.particleCount || 700);
    group.add(nebulaVolume);
    group.userData.nebulaVolume = nebulaVolume;

    // 5. Lighting (Ominous)
    setupCosmicLighting(group);

    // Position center of chapter
    group.position.y = (COSMIC_EXPANSE_CONFIG.yStart + COSMIC_EXPANSE_CONFIG.yEnd) / 2;

    return group;
}

function createVoidSky(uniforms) {
    const geometry = new THREE.SphereGeometry(250, 32, 24);
    const material = new THREE.ShaderMaterial({
        uniforms: { uTime: uniforms.uTime },
        vertexShader: voidVertexShader,
        fragmentShader: voidFragmentShader,
        side: THREE.BackSide,
        depthWrite: false,
    });
    return new THREE.Mesh(geometry, material);
}

function createBlackHole(uniforms) {
    const group = new THREE.Group();
    group.name = 'volumetric-black-hole-anchor';

    const horizon = new THREE.Mesh(
        new THREE.SphereGeometry(24, 48, 32),
        new THREE.MeshBasicMaterial({ color: 0x000000 }),
    );
    horizon.scale.set(1.0, 0.92, 0.82);
    group.add(horizon);

    const haloColors = [0xfff0a0, 0xff6b22, 0xb14dff, 0x4f79ff];
    haloColors.forEach((color, index) => {
        const ring = new THREE.Mesh(
            new THREE.TorusGeometry(31 + index * 9, 1.25 + index * 0.4, 16, 160),
            new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity: 0.72 - index * 0.12,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }),
        );
        ring.scale.y = 0.22 + index * 0.045;
        ring.rotation.x = 0.08 + index * 0.03;
        ring.rotation.y = index * 0.18;
        group.add(ring);
    });

    const lensShell = new THREE.Mesh(
        new THREE.SphereGeometry(42, 48, 24),
        new THREE.MeshBasicMaterial({
            color: 0x6633ff,
            transparent: true,
            opacity: 0.075,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            wireframe: true,
        }),
    );
    group.add(lensShell);

    const farGlow = new THREE.Mesh(
        new THREE.RingGeometry(42, 72, 96),
        new THREE.MeshBasicMaterial({
            color: 0x7f3cff,
            transparent: true,
            opacity: 0.16,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        }),
    );
    farGlow.name = 'distant-accretion-glow';
    farGlow.userData.spin = -0.035;
    group.add(farGlow);

    group.userData.uniforms = uniforms;
    return group;
}

function createHeroPlanet() {
    const group = new THREE.Group();
    group.name = 'hero-planet-nebula-anchor';
    group.position.set(-145, 72, -720);

    const planet = new THREE.Mesh(
        new THREE.SphereGeometry(28, 48, 32),
        new THREE.ShaderMaterial({
            uniforms: {
                uColor1: { value: new THREE.Color(0x273f68) },
                uColor2: { value: new THREE.Color(0x111827) },
            },
            vertexShader: `
                varying vec3 vNormal;
                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 uColor1;
                uniform vec3 uColor2;
                varying vec3 vNormal;
                void main() {
                    float band = sin(vNormal.y * 12.0 + vNormal.x * 3.0) * 0.5 + 0.5;
                    float rim = pow(1.0 - max(0.0, dot(vNormal, vec3(0.0, 0.0, 1.0))), 2.4);
                    vec3 color = mix(uColor2, uColor1, band) + vec3(0.25, 0.45, 0.9) * rim;
                    gl_FragColor = vec4(color, 1.0);
                }
            `,
        }),
    );
    group.add(planet);
    group.userData.planet = planet;

    const atmosphere = new THREE.Mesh(
        new THREE.SphereGeometry(31, 48, 24),
        new THREE.MeshBasicMaterial({
            color: 0x6c9dff,
            transparent: true,
            opacity: 0.12,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        }),
    );
    group.add(atmosphere);

    const ring = new THREE.Mesh(
        new THREE.RingGeometry(38, 54, 96),
        new THREE.MeshBasicMaterial({
            color: 0x8fb0ff,
            transparent: true,
            opacity: 0.18,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            depthWrite: false,
        }),
    );
    ring.rotation.x = Math.PI * 0.43;
    group.add(ring);

    return group;
}

function createNebulaVolume(count) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const palette = [
        new THREE.Color(0x6633ff),
        new THREE.Color(0x2f6bff),
        new THREE.Color(0xff5fb0),
        new THREE.Color(0xffa14a),
    ];

    for (let index = 0; index < count; index += 1) {
        const stride = index * 3;
        positions[stride] = (Math.random() - 0.5) * 420;
        positions[stride + 1] = (Math.random() - 0.5) * 240;
        positions[stride + 2] = -620 - Math.random() * 320;

        const color = palette[index % palette.length];
        colors[stride] = color.r;
        colors[stride + 1] = color.g;
        colors[stride + 2] = color.b;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const points = new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
            size: 4.2,
            vertexColors: true,
            transparent: true,
            opacity: 0.18,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
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
        radii[i] = 30 + Math.random() * 50; // Start far out
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

    return new THREE.Points(geometry, material);
}

function createVoidStars(uniforms, count) {
    // Simple bright distant stars
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = 200 + Math.random() * 50;
        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.cos(phi);
        positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
        sizes[i] = 0.5 + Math.random();
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 2,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.8,
    });

    return new THREE.Points(geometry, material);
}

function setupCosmicLighting(group) {
    // Dim ambient
    group.add(new THREE.AmbientLight(0x111111, 0.5));

    // Accretion disk lighting
    const diskLight = new THREE.PointLight(0xff6600, 1.0, 100);
    diskLight.position.set(0, 20, -100);
    group.add(diskLight);

    // Eerie back lighting
    const rimLight = new THREE.DirectionalLight(0x4400cc, 0.5);
    rimLight.position.set(0, 50, -200);
    group.add(rimLight);
}

export function updateCosmicExpanseEnvironment(group, delta, time) {
    const { uniforms } = group.userData;
    if (uniforms?.uTime) {
        uniforms.uTime.value = time;
    }

    // Rotate the black hole mesh slightly to enhance the swirling effect
    const { blackHole } = group.userData;
    if (blackHole) {
        blackHole.rotation.z -= delta * 0.1;
        blackHole.children.forEach((child, index) => {
            if (child.userData?.spin) {
                child.rotation.z += delta * child.userData.spin;
            } else if (index > 0) {
                child.rotation.z += delta * (0.025 + index * 0.006);
            }
        });
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
}

export default {
    config: COSMIC_EXPANSE_CONFIG,
    create: createCosmicExpanseEnvironment,
    update: updateCosmicExpanseEnvironment,
};
