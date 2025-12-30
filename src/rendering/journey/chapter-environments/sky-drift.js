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
    yStart: 95,
    yEnd: 125,
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
    varying vec3 vPosition;
    void main() {
        float t = (normalize(vPosition).y + 1.0) * 0.5;
        vec3 spaceTop = vec3(0.02, 0.02, 0.06);
        vec3 spaceMid = vec3(0.06, 0.05, 0.14);
        vec3 horizon = vec3(0.12, 0.08, 0.22);
        vec3 color;
        if (t > 0.6) {
            color = mix(spaceMid, spaceTop, (t - 0.6) / 0.4);
        } else if (t > 0.3) {
            color = mix(horizon, spaceMid, (t - 0.3) / 0.3);
        } else {
            color = horizon;
        }
        gl_FragColor = vec4(color, 1.0);
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

// ═══════════════════════════════════════════════════════════════════════════════
// Environment Creation
// ═══════════════════════════════════════════════════════════════════════════════

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

    // Dense starfield
    const starCount = options.particleCount ? options.particleCount * 4 : 2500;
    group.add(createStars(uniforms, starCount));

    // COSMIC OBJECTS
    // 1. Distant spiral galaxy
    const galaxy = createSpiralGalaxy(uniforms);
    galaxy.position.set(-60, 25, -180);
    galaxy.rotation.x = 0.7;
    galaxy.rotation.z = 0.3;
    galaxy.scale.setScalar(0.8);
    group.add(galaxy);
    group.userData.galaxy = galaxy;

    // 2. Solar eclipse
    const eclipse = createSolarEclipse(uniforms);
    eclipse.position.set(50, 15, -150);
    eclipse.scale.setScalar(0.5);
    group.add(eclipse);
    group.userData.eclipse = eclipse;

    // 3. Colorful nebulae
    const nebulae = createNebulae(uniforms);
    group.add(nebulae);

    // 4. Distant planets
    const planets = createPlanets(uniforms);
    group.add(planets);
    group.userData.planets = planets;

    // 5. Ambient drift particles
    const ambient = createAmbientParticles(uniforms, options.particleCount || 400);
    group.add(ambient);

    setupSkyLighting(group);
    group.position.y = (SKY_DRIFT_CONFIG.yStart + SKY_DRIFT_CONFIG.yEnd) / 2;

    return group;
}

function createSkyGradient(uniforms) {
    const geometry = new THREE.SphereGeometry(250, 32, 24);
    const material = new THREE.ShaderMaterial({
        uniforms: { uTime: uniforms.uTime },
        vertexShader: skyGradientVertexShader,
        fragmentShader: skyGradientFragmentShader,
        side: THREE.BackSide,
        depthWrite: false,
    });
    return new THREE.Mesh(geometry, material);
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
            color: color,
            transparent: true,
            opacity: opacity,
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
        const radius = 0.5 + Math.pow(t, 0.4) * 18;
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
            color: color,
            transparent: true,
            opacity: opacity,
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

/**
 * Create colorful nebula formations
 */
function createNebulae(uniforms) {
    const nebulaGroup = new THREE.Group();
    nebulaGroup.name = 'nebulae';

    const glowTexture = createGlowTexture();
    const configs = [
        { pos: [-80, 5, -160], scale: 50, color: 0xFF33CC, opacity: 0.3 },
        { pos: [80, -10, -170], scale: 60, color: 0x3399FF, opacity: 0.25 },
        { pos: [0, 35, -190], scale: 70, color: 0x9933FF, opacity: 0.2 },
        { pos: [-40, -20, -140], scale: 40, color: 0x66CCFF, opacity: 0.25 },
        { pos: [60, 30, -180], scale: 45, color: 0xCC44FF, opacity: 0.22 },
    ];

    configs.forEach(({ pos, scale, color, opacity }) => {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: glowTexture,
            color: color,
            transparent: true,
            opacity: opacity,
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
        { pos: [-90, -15, -130], size: 6, color1: 0x2E4A62, color2: 0x1A2D3D, hasRing: false },
        { pos: [100, 20, -160], size: 10, color1: 0xA67C52, color2: 0x6B4423, hasRing: true },
        { pos: [-30, 40, -200], size: 4, color1: 0x4A626E, color2: 0x2C3E50, hasRing: false },
    ];

    planetConfigs.forEach(({ pos, size, color1, color2, hasRing }) => {
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
        positions[i * 3] = (Math.random() - 0.5) * 150;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 80;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 120 - 40;
        sizes[i] = 1 + Math.random() * 2;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(new Float32Array(count).map(() => Math.random() * 6.28), 1));
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

    const purpleGlow = new THREE.PointLight(0x9933FF, 0.4, 200);
    purpleGlow.position.set(-30, 20, -100);
    group.add(purpleGlow);
    group.userData.purpleGlow = purpleGlow;

    const cyanGlow = new THREE.PointLight(0x3399FF, 0.3, 180);
    cyanGlow.position.set(40, 10, -90);
    group.add(cyanGlow);

    const eclipseGlow = new THREE.PointLight(0xFFAA44, 0.5, 150);
    eclipseGlow.position.set(50, 15, -120);
    group.add(eclipseGlow);
}

export function updateSkyDriftEnvironment(group, delta, time) {
    const uniforms = group.userData.uniforms;
    if (uniforms?.uTime) {
        uniforms.uTime.value = time;
    }

    // Pulse lighting
    const purpleGlow = group.userData.purpleGlow;
    if (purpleGlow) {
        purpleGlow.intensity = 0.4 + Math.sin(time * 0.3) * 0.15;
    }

    // Slowly rotate galaxy
    const galaxy = group.userData.galaxy;
    if (galaxy) {
        galaxy.rotation.z += delta * 0.01;
    }

    // Rotate planets
    const planets = group.userData.planets;
    if (planets) {
        planets.children.forEach((planet, i) => {
            planet.rotation.y += delta * (0.05 + i * 0.02);
        });
    }
}

export default {
    config: SKY_DRIFT_CONFIG,
    create: createSkyDriftEnvironment,
    update: updateSkyDriftEnvironment,
};
