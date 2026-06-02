/**
 * @fileoverview Sky Drift Environment - Chapter 5 Visual Theme
 *
 * Creates a stunning cosmic vista with actual celestial objects:
 * - Distant spiral galaxy with glowing core and arms
 * - Solar eclipse with corona glow
 * - Colorful nebulae formations
 * - Floating planets
 * - Dense starfield
 *
 * Theme: "Float among clouds" - transitioning to deep space
 */

import * as THREE from 'three';

/**
 * Sky Drift environment configuration
 */
export const SKY_DRIFT_CONFIG = {
    id: 5,
    name: 'sky-drift',
    yStart: 500,
    yEnd: 750,
    colors: {
        primary: 0x1a1a2e,
        secondary: 0x16213e,
        tertiary: 0x533483,
        accent: 0x0f3460,
        background: 0x0a0a14,
    },
};

// ═══════════════════════════════════════════════════════════════════════════════
// GLSL Shaders
// ═══════════════════════════════════════════════════════════════════════════════

const skyGradientVertexShader = `
    varying vec3 vPosition;
    void main() {
        vPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const skyGradientFragmentShader = `
    uniform float uOpacity;
    varying vec3 vPosition;
    void main() {
        float t = (normalize(vPosition).y + 1.0) * 0.5;
        // Much darker space colors
        vec3 spaceTop = vec3(0.0, 0.0, 0.02);       // Near black
        vec3 spaceMid = vec3(0.02, 0.01, 0.05);     // Very dark purple
        vec3 horizon = vec3(0.04, 0.02, 0.08);      // Dark purple horizon
        vec3 color;
        if (t > 0.6) {
            color = mix(spaceMid, spaceTop, (t - 0.6) / 0.4);
        } else if (t > 0.3) {
            color = mix(horizon, spaceMid, (t - 0.3) / 0.3);
        } else {
            color = horizon;
        }
        gl_FragColor = vec4(color, uOpacity);
    }
`;

// Spiral galaxy arms shader
const galaxyVertexShader = `
    uniform float uTime;
    attribute float aAngle;
    attribute float aRadius;
    attribute float aRandom;
    attribute vec3 aColor;
    varying vec3 vColor;
    varying float vAlpha;
    
    void main() {
        float angle = aAngle + uTime * 0.03 * (1.0 - aRadius * 0.05);
        float spiralOffset = aRadius * 0.4;
        float finalAngle = angle + spiralOffset;
        
        vec3 pos = vec3(
            cos(finalAngle) * aRadius,
            (aRandom - 0.5) * 0.5,
            sin(finalAngle) * aRadius
        );
        
        vec3 transformed = position + pos;
        vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        
        float sizeFactor = 1.0 - aRadius * 0.05;
        gl_PointSize = (1.5 + aRandom * 1.5) * sizeFactor * (100.0 / -mvPosition.z);
        gl_PointSize = clamp(gl_PointSize, 0.5, 4.0);
        
        vColor = aColor;
        vAlpha = 0.6 + aRandom * 0.4;
    }
`;

const galaxyFragmentShader = `
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
        float dist = length(gl_PointCoord - 0.5);
        if (dist > 0.5) discard;
        float alpha = 1.0 - smoothstep(0.2, 0.5, dist);
        gl_FragColor = vec4(vColor, alpha * vAlpha);
    }
`;

// Corona glow shader for eclipse
const coronaVertexShader = `
    uniform float uTime;
    attribute float aPhase;
    attribute float aSpeed;
    varying float vAlpha;
    varying vec3 vColor;
    attribute vec3 aColor;
    
    void main() {
        vec3 pos = position;
        float wave = sin(uTime * aSpeed + aPhase) * 0.5 + 0.5;
        pos *= 1.0 + wave * 0.1;
        
        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = (2.0 + wave * 2.0) * (150.0 / -mvPosition.z);
        gl_PointSize = clamp(gl_PointSize, 0.5, 5.0);
        
        vAlpha = 0.4 + wave * 0.3;
        vColor = aColor;
    }
`;

const coronaFragmentShader = `
    varying float vAlpha;
    varying vec3 vColor;
    void main() {
        float dist = length(gl_PointCoord - 0.5);
        if (dist > 0.5) discard;
        float glow = pow(1.0 - dist * 2.0, 1.5);
        gl_FragColor = vec4(vColor, glow * vAlpha);
    }
`;

// Planet shader
const planetVertexShader = `
    varying vec3 vNormal;
    varying vec3 vViewPos;
    void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPos = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
    }
`;

const planetFragmentShader = `
    uniform vec3 uColor1;
    uniform vec3 uColor2;
    uniform float uTime;
    varying vec3 vNormal;
    varying vec3 vViewPos;
    
    void main() {
        vec3 viewDir = normalize(vViewPos);
        float fresnel = pow(1.0 - max(0.0, dot(vNormal, viewDir)), 2.0);
        
        float stripe = sin(vNormal.y * 10.0 + uTime * 0.1) * 0.5 + 0.5;
        vec3 color = mix(uColor1, uColor2, stripe);
        
        color += fresnel * vec3(0.3, 0.4, 0.6) * 0.5;
        
        float diffuse = max(0.0, dot(vNormal, normalize(vec3(1.0, 0.5, 0.3))));
        color *= 0.4 + diffuse * 0.6;
        
        gl_FragColor = vec4(color, 1.0);
    }
`;

// Star shader
const starVertexShader = `
    uniform float uTime;
    attribute float aSize;
    attribute float aTwinkle;
    attribute float aBrightness;
    varying float vAlpha;
    
    void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        float twinkle = sin(uTime * 2.0 + aTwinkle) * 0.4 + 0.6;
        gl_PointSize = aSize * twinkle * (200.0 / -mvPosition.z);
        gl_PointSize = clamp(gl_PointSize, 0.5, 5.0);
        vAlpha = twinkle * aBrightness;
    }
`;

const starFragmentShader = `
    varying float vAlpha;
    void main() {
        float dist = length(gl_PointCoord - 0.5);
        if (dist > 0.5) discard;
        float glow = pow(1.0 - dist * 2.0, 1.5);
        gl_FragColor = vec4(0.9, 0.92, 1.0, glow * vAlpha);
    }
`;

const cloudShaftVertexShader = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const cloudShaftFragmentShader = `
    uniform float uTime;
    varying vec2 vUv;
    void main() {
        vec2 centered = vUv - 0.5;
        float radial = smoothstep(0.52, 0.05, length(centered * vec2(0.65, 1.2)));
        float rays = pow(max(0.0, sin((vUv.x * 18.0) + uTime * 0.28)), 3.0) * 0.22;
        vec3 color = mix(vec3(0.55, 0.74, 1.0), vec3(1.0, 0.86, 0.54), vUv.y);
        gl_FragColor = vec4(color * (0.35 + rays), radial * 0.32);
    }
`;

const auroraVertexShader = `
    uniform float uTime;
    varying vec2 vUv;
    void main() {
        vUv = uv;
        vec3 transformed = position;
        transformed.y += sin(position.x * 0.018 + uTime * 0.45) * 7.0;
        transformed.y += sin(position.x * 0.039 - uTime * 0.28) * 3.5;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
    }
`;

const auroraFragmentShader = `
    uniform float uTime;
    uniform vec3 uColorA;
    uniform vec3 uColorB;
    varying vec2 vUv;
    void main() {
        float curtain = sin(vUv.x * 38.0 + uTime * 0.75) * 0.5 + 0.5;
        float vertical = smoothstep(0.0, 0.22, vUv.y) * smoothstep(1.0, 0.18, vUv.y);
        float strands = pow(curtain, 3.0) * 0.55 + 0.2;
        vec3 color = mix(uColorA, uColorB, vUv.x);
        gl_FragColor = vec4(color * (0.7 + strands), vertical * strands * 0.58);
    }
`;

// ═══════════════════════════════════════════════════════════════════════════════
// Environment Creation
// ═══════════════════════════════════════════════════════════════════════════════

function createSkyGradient(uniforms) {
    const geometry = new THREE.SphereGeometry(2500, 64, 48); // Large sphere like Ch4
    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: uniforms.uTime,
            uOpacity: { value: 1.0 },
        },
        vertexShader: skyGradientVertexShader,
        fragmentShader: skyGradientFragmentShader,
        side: THREE.BackSide,
        depthWrite: false,
        transparent: true, // Allow Chapter 4 to show through
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = -100; // Render behind everything
    return mesh;
}

function createStars(uniforms, count) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const twinkles = new Float32Array(count);
    const brightnesses = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = 180 + Math.random() * 40;
        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.cos(phi);
        positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
        sizes[i] = 0.5 + Math.random() * 2.5;
        twinkles[i] = Math.random() * Math.PI * 2;
        brightnesses[i] = 0.4 + Math.random() * 0.6;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkles, 1));
    geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightnesses, 1));

    const material = new THREE.ShaderMaterial({
        uniforms: { uTime: uniforms.uTime },
        vertexShader: starVertexShader,
        fragmentShader: starFragmentShader,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });

    return new THREE.Points(geometry, material);
}

/**
 * Create a detailed spiral galaxy with core and arms
 */
function createSpiralGalaxy(uniforms) {
    const galaxyGroup = new THREE.Group();
    galaxyGroup.name = 'spiral-galaxy';

    // Glow texture for core
    const glowTexture = createGlowTexture();

    // Galaxy core - layered glow sprites
    const coreColors = [
        { color: 0xFFFFFF, scale: 4, opacity: 0.95 },
        { color: 0xFF66CC, scale: 8, opacity: 0.8 },
        { color: 0x9933FF, scale: 14, opacity: 0.5 },
        { color: 0x3366FF, scale: 22, opacity: 0.3 },
    ];

    coreColors.forEach(({ color, scale, opacity }) => {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: glowTexture,
            color,
            transparent: true,
            opacity,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        }));
        sprite.scale.set(scale, scale, 1);
        galaxyGroup.add(sprite);
    });

    // Spiral arms - 4000 particles
    const armCount = 4000;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(armCount * 3);
    const angles = new Float32Array(armCount);
    const radii = new Float32Array(armCount);
    const randoms = new Float32Array(armCount);
    const colors = new Float32Array(armCount * 3);

    for (let i = 0; i < armCount; i++) {
        const arm = i % 2;
        const baseAngle = arm * Math.PI;
        const t = Math.random();
        const radius = 0.5 + t ** 0.4 * 18;
        const spiralOffset = radius * 0.35;
        const spread = (Math.random() - 0.5) * (0.3 + radius * 0.02);

        angles[i] = baseAngle + spiralOffset + spread;
        radii[i] = radius;
        randoms[i] = Math.random();
        positions[i * 3] = 0;
        positions[i * 3 + 1] = 0;
        positions[i * 3 + 2] = 0;

        // Color gradient from center
        const colorT = Math.min(radius / 16, 1.0);
        let color;
        if (colorT < 0.2) {
            color = new THREE.Color(0xFFFFFF).lerp(new THREE.Color(0xFFAADD), colorT / 0.2);
        } else if (colorT < 0.5) {
            color = new THREE.Color(0xFFAADD).lerp(new THREE.Color(0xCC44FF), (colorT - 0.2) / 0.3);
        } else {
            color = new THREE.Color(0xCC44FF).lerp(new THREE.Color(0x6633CC), (colorT - 0.5) / 0.5);
        }
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aAngle', new THREE.BufferAttribute(angles, 1));
    geometry.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));
    geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.ShaderMaterial({
        uniforms: { uTime: uniforms.uTime },
        vertexShader: galaxyVertexShader,
        fragmentShader: galaxyFragmentShader,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });

    galaxyGroup.add(new THREE.Points(geometry, material));
    return galaxyGroup;
}

/**
 * Create a solar eclipse with sun, moon, and corona
 */
function createSolarEclipse(uniforms) {
    const eclipseGroup = new THREE.Group();
    eclipseGroup.name = 'solar-eclipse';

    const glowTexture = createGlowTexture();

    // Sun glow layers (behind moon)
    const sunColors = [
        { color: 0xFFDD77, scale: 30, opacity: 0.9 },
        { color: 0xFFAA44, scale: 45, opacity: 0.6 },
        { color: 0xFF7722, scale: 60, opacity: 0.3 },
    ];

    sunColors.forEach(({ color, scale, opacity }) => {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: glowTexture,
            color,
            transparent: true,
            opacity,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        }));
        sprite.scale.set(scale, scale, 1);
        sprite.position.z = -1;
        eclipseGroup.add(sprite);
    });

    // Dark moon in front
    const moonGeometry = new THREE.SphereGeometry(12, 32, 32);
    const moonMaterial = new THREE.MeshBasicMaterial({
        color: 0x050505,
    });
    const moon = new THREE.Mesh(moonGeometry, moonMaterial);
    moon.position.z = 0.5;
    eclipseGroup.add(moon);

    // Corona particles
    const coronaCount = 600;
    const coronaGeometry = new THREE.BufferGeometry();
    const coronaPositions = new Float32Array(coronaCount * 3);
    const coronaColors = new Float32Array(coronaCount * 3);
    const coronaPhases = new Float32Array(coronaCount);
    const coronaSpeeds = new Float32Array(coronaCount);

    const coronaPalette = [
        new THREE.Color(0xffdd77),
        new THREE.Color(0xffaa44),
        new THREE.Color(0xff7722),
        new THREE.Color(0xffcc55),
    ];

    for (let i = 0; i < coronaCount; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const radius = 14 + Math.random() * 12;

        coronaPositions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
        coronaPositions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
        coronaPositions[i * 3 + 2] = radius * Math.cos(phi) * 0.3;

        const color = coronaPalette[Math.floor(Math.random() * coronaPalette.length)];
        coronaColors[i * 3] = color.r;
        coronaColors[i * 3 + 1] = color.g;
        coronaColors[i * 3 + 2] = color.b;

        coronaPhases[i] = Math.random() * Math.PI * 2;
        coronaSpeeds[i] = 1 + Math.random() * 2;
    }

    coronaGeometry.setAttribute('position', new THREE.BufferAttribute(coronaPositions, 3));
    coronaGeometry.setAttribute('aColor', new THREE.BufferAttribute(coronaColors, 3));
    coronaGeometry.setAttribute('aPhase', new THREE.BufferAttribute(coronaPhases, 1));
    coronaGeometry.setAttribute('aSpeed', new THREE.BufferAttribute(coronaSpeeds, 1));

    const coronaMaterial = new THREE.ShaderMaterial({
        uniforms: { uTime: uniforms.uTime },
        vertexShader: coronaVertexShader,
        fragmentShader: coronaFragmentShader,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });

    eclipseGroup.add(new THREE.Points(coronaGeometry, coronaMaterial));
    return eclipseGroup;
}

function createCloudBreakShaft(uniforms) {
    const shaft = new THREE.Mesh(
        new THREE.PlaneGeometry(260, 360, 1, 1),
        new THREE.ShaderMaterial({
            uniforms: { uTime: uniforms.uTime },
            vertexShader: cloudShaftVertexShader,
            fragmentShader: cloudShaftFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
        }),
    );
    shaft.name = 'cloud-break-light-shaft';
    shaft.position.set(0, 40, -620);
    shaft.rotation.x = -0.08;
    return shaft;
}

function createCloudDecks() {
    const group = new THREE.Group();
    group.name = 'cloud-deck-break';
    const glowTexture = createGlowTexture();
    const cloudColors = [0xcfe9ff, 0xffe6cc, 0xb6c8ff];

    for (let layer = 0; layer < 3; layer += 1) {
        const radius = 95 + layer * 38;
        const count = 24 + layer * 8;
        for (let index = 0; index < count; index += 1) {
            const angle = (index / count) * Math.PI * 2 + layer * 0.33;
            const gap = Math.abs(Math.sin(angle * 0.5));
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
                map: glowTexture,
                color: cloudColors[(index + layer) % cloudColors.length],
                transparent: true,
                opacity: (0.18 + layer * 0.05) * (0.55 + gap * 0.45),
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }));
            sprite.position.set(
                Math.cos(angle) * radius,
                -30 + Math.sin(angle * 1.7) * 18 + layer * 8,
                -500 - layer * 70 + Math.sin(angle) * 28,
            );
            const scale = 42 + Math.random() * 34 + layer * 10;
            sprite.scale.set(scale * 1.8, scale, 1);
            group.add(sprite);
        }
    }

    return group;
}

function createAuroraRibbons(uniforms) {
    const group = new THREE.Group();
    group.name = 'aurora-ribbons';
    const configs = [
        {
            y: 88, z: -690, colorA: 0x64f7ff, colorB: 0xb15cff, rot: -0.12,
        },
        {
            y: 118, z: -760, colorA: 0xffd36f, colorB: 0x7af7c4, rot: 0.16,
        },
    ];

    configs.forEach((config) => {
        const mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(360, 86, 72, 1),
            new THREE.ShaderMaterial({
                uniforms: {
                    uTime: uniforms.uTime,
                    uColorA: { value: new THREE.Color(config.colorA) },
                    uColorB: { value: new THREE.Color(config.colorB) },
                },
                vertexShader: auroraVertexShader,
                fragmentShader: auroraFragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
            }),
        );
        mesh.position.set(0, config.y, config.z);
        mesh.rotation.z = config.rot;
        group.add(mesh);
    });

    return group;
}

function createRainVeils(count) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);

    for (let index = 0; index < count; index += 1) {
        const stride = index * 3;
        positions[stride] = (Math.random() - 0.5) * 360;
        positions[stride + 1] = Math.random() * 240 - 80;
        positions[stride + 2] = -390 - Math.random() * 280;
        speeds[index] = 0.45 + Math.random() * 0.85;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));

    const veil = new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
            color: 0xaad4ff,
            size: 1.5,
            transparent: true,
            opacity: 0.28,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        }),
    );
    veil.name = 'rain-veil-particles';
    return veil;
}

export function createSkyDriftEnvironment(options = {}) {
    const group = new THREE.Group();
    group.name = 'sky-drift-environment';
    group.userData.chapterId = 5;
    group.userData.yStart = SKY_DRIFT_CONFIG.yStart;
    group.userData.yEnd = SKY_DRIFT_CONFIG.yEnd;

    const uniforms = { uTime: { value: 0 } };
    group.userData.uniforms = uniforms;

    // Sky background
    group.add(createSkyGradient(uniforms));

    const cloudDecks = createCloudDecks();
    group.add(cloudDecks);
    group.userData.cloudDecks = cloudDecks;

    const lightShaft = createCloudBreakShaft(uniforms);
    group.add(lightShaft);
    group.userData.lightShaft = lightShaft;

    const aurora = createAuroraRibbons(uniforms);
    group.add(aurora);
    group.userData.aurora = aurora;

    // Dense starfield
    const starCount = options.particleCount ? options.particleCount * 4 : 2500;
    group.add(createStars(uniforms, starCount));

    // COSMIC OBJECTS
    // 1. Distant spiral galaxy - Moved deep into Z (-800) and adjusted Y
    const galaxy = createSpiralGalaxy(uniforms);
    galaxy.position.set(-80, 50, -850);
    galaxy.rotation.x = 0.7;
    galaxy.rotation.z = 0.3;
    galaxy.scale.setScalar(2.5); // Larger because it's further away
    group.add(galaxy);
    group.userData.galaxy = galaxy;

    // 2. Solar eclipse - Moved deep into Z (-750)
    const eclipse = createSolarEclipse(uniforms);
    eclipse.position.set(120, 80, -750);
    eclipse.scale.setScalar(1.5);
    group.add(eclipse);
    group.userData.eclipse = eclipse;

    // 3. Colorful nebulae - Moved deep into Z
    const nebulae = createNebulae(uniforms);
    group.add(nebulae);

    // 4. Distant planets - Moved deep into Z
    const planets = createPlanets(uniforms);
    group.add(planets);
    group.userData.planets = planets;

    // 5. Ambient drift particles
    const ambient = createAmbientParticles(uniforms, options.particleCount || 400);
    group.add(ambient);

    const rainVeils = createRainVeils(options.particleCount || 420);
    group.add(rainVeils);
    group.userData.rainVeils = rainVeils;

    setupSkyLighting(group);
    group.position.y = (SKY_DRIFT_CONFIG.yStart + SKY_DRIFT_CONFIG.yEnd) / 2;

    return group;
}

/**
 * Create colorful nebula formations
 */
function createNebulae() {
    const nebulaGroup = new THREE.Group();
    nebulaGroup.name = 'nebulae';

    const glowTexture = createGlowTexture();
    const configs = [
        {
            pos: [-150, -40, -800], scale: 120, color: 0xFF33CC, opacity: 0.3,
        },
        {
            pos: [150, -60, -820], scale: 140, color: 0x3399FF, opacity: 0.25,
        },
        {
            pos: [0, 80, -850], scale: 160, color: 0x9933FF, opacity: 0.2,
        },
        {
            pos: [-80, -90, -780], scale: 100, color: 0x66CCFF, opacity: 0.25,
        },
        {
            pos: [100, 50, -810], scale: 110, color: 0xCC44FF, opacity: 0.22,
        },
    ];

    configs.forEach(({
        pos, scale, color, opacity,
    }) => {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: glowTexture,
            color,
            transparent: true,
            opacity,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        }));
        sprite.position.set(...pos);
        sprite.scale.set(scale, scale, 1);
        nebulaGroup.add(sprite);
    });

    return nebulaGroup;
}

/**
 * Create distant planets with atmospheric effects
 */
function createPlanets(uniforms) {
    const planetGroup = new THREE.Group();
    planetGroup.name = 'planets';

    const planetConfigs = [
        {
            pos: [-120, -50, -750], size: 15, color1: 0x2E4A62, color2: 0x1A2D3D, hasRing: false,
        },
        {
            pos: [140, 60, -780], size: 25, color1: 0xA67C52, color2: 0x6B4423, hasRing: true,
        },
        {
            pos: [-40, 90, -820], size: 10, color1: 0x4A626E, color2: 0x2C3E50, hasRing: false,
        },
    ];

    planetConfigs.forEach(({
        pos, size, color1, color2, hasRing,
    }) => {
        const geometry = new THREE.SphereGeometry(size, 32, 32);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: uniforms.uTime,
                uColor1: { value: new THREE.Color(color1) },
                uColor2: { value: new THREE.Color(color2) },
            },
            vertexShader: planetVertexShader,
            fragmentShader: planetFragmentShader,
        });

        const planet = new THREE.Mesh(geometry, material);
        planet.position.set(...pos);

        // Add ring for gas giant
        if (hasRing) {
            const ringGeometry = new THREE.RingGeometry(size * 1.4, size * 2, 64);
            const ringMaterial = new THREE.MeshBasicMaterial({
                color: 0x8B7355,
                transparent: true,
                opacity: 0.5,
                side: THREE.DoubleSide,
            });
            const ring = new THREE.Mesh(ringGeometry, ringMaterial);
            ring.rotation.x = Math.PI * 0.4;
            planet.add(ring);
        }

        planetGroup.add(planet);
    });

    return planetGroup;
}

/**
 * Ambient drift particles
 */
function createAmbientParticles(uniforms, count) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        const r = 100 + Math.random() * 200;
        const theta = Math.random() * Math.PI * 2;
        // Spread particles around the path in deep space
        positions[i * 3] = r * Math.cos(theta);
        positions[i * 3 + 1] = (Math.random() - 0.5) * 300; // Increased vertical spread
        positions[i * 3 + 2] = -500 - Math.random() * 400; // Deep Z spread
        sizes[i] = 1 + Math.random() * 2;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute(
        'aTwinkle',
        new THREE.BufferAttribute(new Float32Array(count).map(() => Math.random() * 6.28), 1),
    );
    geometry.setAttribute('aBrightness', new THREE.BufferAttribute(new Float32Array(count).fill(0.5), 1));

    const material = new THREE.ShaderMaterial({
        uniforms: { uTime: uniforms.uTime },
        vertexShader: starVertexShader,
        fragmentShader: starFragmentShader,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });

    return new THREE.Points(geometry, material);
}

function createGlowTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.8)');
    gradient.addColorStop(0.4, 'rgba(255, 255, 255, 0.4)');
    gradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.1)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(canvas);
}

function setupSkyLighting(group) {
    group.add(new THREE.AmbientLight(0x1a1a2e, 0.3));

    const purpleGlow = new THREE.PointLight(0x9933FF, 0.4, 400); // Increased range
    purpleGlow.position.set(-50, 40, -600);
    group.add(purpleGlow);
    group.userData.purpleGlow = purpleGlow;

    const cyanGlow = new THREE.PointLight(0x3399FF, 0.3, 400);
    cyanGlow.position.set(60, 20, -600);
    group.add(cyanGlow);

    const eclipseGlow = new THREE.PointLight(0xFFAA44, 0.5, 300);
    eclipseGlow.position.set(120, 80, -700);
    group.add(eclipseGlow);
}

export function updateSkyDriftEnvironment(group, delta, time) {
    const { uniforms } = group.userData;
    if (uniforms?.uTime) {
        uniforms.uTime.value = time;
    }

    // Pulse lighting
    const { purpleGlow } = group.userData;
    if (purpleGlow) {
        purpleGlow.intensity = 0.4 + Math.sin(time * 0.3) * 0.15;
    }

    // Slowly rotate galaxy
    const { galaxy } = group.userData;
    if (galaxy) {
        galaxy.rotation.z += delta * 0.01;
    }

    const { cloudDecks } = group.userData;
    if (cloudDecks) {
        cloudDecks.rotation.y += delta * 0.006;
        cloudDecks.rotation.z = Math.sin(time * 0.07) * 0.015;
    }

    // Rotate planets
    const { planets } = group.userData;
    if (planets) {
        planets.children.forEach((planet, i) => {
            planet.rotation.y += delta * (0.05 + i * 0.02);
        });
    }

    const { rainVeils } = group.userData;
    const positionAttr = rainVeils?.geometry?.attributes?.position;
    const speedAttr = rainVeils?.geometry?.attributes?.aSpeed;
    if (positionAttr && speedAttr) {
        const { array } = positionAttr;
        for (let index = 0; index < speedAttr.count; index += 1) {
            const stride = index * 3;
            array[stride + 1] -= speedAttr.array[index] * 1.7;
            array[stride] += Math.sin(time * 0.45 + index) * 0.012;
            if (array[stride + 1] < -105) {
                array[stride + 1] = 135;
            }
        }
        positionAttr.needsUpdate = true;
    }
}

export default {
    config: SKY_DRIFT_CONFIG,
    create: createSkyDriftEnvironment,
    update: updateSkyDriftEnvironment,
};
