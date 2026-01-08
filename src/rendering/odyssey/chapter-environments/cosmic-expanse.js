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
        primary: 0x0a0a0a,    // Void black
        secondary: 0x1a1a2e,  // Deep blue-black
        tertiary: 0xff3300,   // Accretion orange
        accent: 0x4400cc,     // Event horizon purple
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

// Black Hole Event Horizon + Accretion Disk Shader
// Simplified version of the full theme's shader for background use
const blackHoleVertexShader = `
    varying vec2 vUv;
    varying vec3 vPosition;
    varying vec3 vViewPosition;
    void main() {
        vUv = uv;
        vPosition = position;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
    }
`;

const blackHoleFragmentShader = `
    uniform float uTime;
    varying vec2 vUv;
    varying vec3 vPosition;
    
    // Noise functions
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }
    
    float snoise(vec2 v) {
        const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
        vec2 i  = floor(v + dot(v, C.yy) );
        vec2 x0 = v - i + dot(i, C.xx);
        vec2 i1;
        i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod289(i);
        vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 )) + i.x + vec3(0.0, i1.x, 1.0 ));
        vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
        m = m*m ;
        m = m*m ;
        vec3 x = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x) - 0.5;
        vec3 ox = floor(x + 0.5);
        vec3 a0 = x - ox;
        m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
        vec3 g;
        g.x  = a0.x  * x0.x  + h.x  * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
    }

    void main() {
        vec2 center = vec2(0.5, 0.5);
        vec2 uv = vUv - center;
        float dist = length(uv);
        float angle = atan(uv.y, uv.x);
        
        // Event Horizon (Black circle)
        float horizonRadius = 0.15;
        float horizonEdge = smoothstep(horizonRadius, horizonRadius + 0.01, dist);
        
        // Accretion Disk
        float spiral = angle + 10.0 / (dist + 0.1); // Spiral distortion
        float noise = snoise(vec2(spiral * 2.0, dist * 10.0 - uTime * 2.0));
        
        // Color Mapping
        vec3 innerColor = vec3(1.0, 0.8, 0.4); // Hot white/orange
        vec3 midColor = vec3(1.0, 0.3, 0.0);   // Deep orange
        vec3 outerColor = vec3(0.5, 0.0, 0.2); // Red/Purple edge
        
        vec3 diskColor = mix(midColor, innerColor, noise * 0.5 + 0.5);
        diskColor = mix(diskColor, outerColor, dist * 2.0);
        
        // Disk Shape intensity
        float diskIntensity = smoothstep(0.15, 0.2, dist) * smoothstep(0.5, 0.2, dist);
        diskIntensity *= (0.8 + noise * 0.4); // Add turbulence
        
        // Bright inner ring (photon ring)
        float photonRing = smoothstep(0.15, 0.16, dist) * smoothstep(0.18, 0.16, dist);
        
        vec3 finalColor = diskColor * diskIntensity + vec3(1.0, 1.0, 0.9) * photonRing * 2.0;
        
        // Apply horizon mask (black center)
        finalColor *= horizonEdge;
        
        // Soft outer glow
        float glow = smoothstep(1.0, 0.0, dist) * 0.1;
        finalColor += vec3(0.2, 0.0, 0.4) * glow;
        
        gl_FragColor = vec4(finalColor, diskIntensity + photonRing * 2.0 + glow);
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

    // 3. Suction Particles (Matter falling in)
    const debris = createSuctionParticles(uniforms, options.particleCount || 1000);
    debris.position.set(0, 0, -800); // Centered on Black Hole
    debris.rotation.x = -0.3;
    debris.scale.setScalar(1.5);
    group.add(debris);

    // 4. Distant "Stellar Velocity" Stars
    const stars = createVoidStars(uniforms, 2000);
    group.add(stars);

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
    // A plane that billboards slightly but renders the accretion disk
    const geometry = new THREE.PlaneGeometry(120, 120);
    const material = new THREE.ShaderMaterial({
        uniforms: { uTime: uniforms.uTime },
        vertexShader: blackHoleVertexShader,
        fragmentShader: blackHoleFragmentShader,
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending, // Alpha blending for the disk
        side: THREE.DoubleSide,
    });

    return new THREE.Mesh(geometry, material);
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
    const uniforms = group.userData.uniforms;
    if (uniforms?.uTime) {
        uniforms.uTime.value = time;
    }

    // Rotate the black hole mesh slightly to enhance the swirling effect
    const blackHole = group.userData.blackHole;
    if (blackHole) {
        blackHole.rotation.z -= delta * 0.1;
    }
}

export default {
    config: COSMIC_EXPANSE_CONFIG,
    create: createCosmicExpanseEnvironment,
    update: updateCosmicExpanseEnvironment,
};
