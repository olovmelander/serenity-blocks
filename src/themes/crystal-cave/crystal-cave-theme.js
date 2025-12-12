/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CRYSTAL CAVE THEME - Three.js 3D Implementation (Reworked)
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * An immersive underground crystal cave featuring:
 * - Proper multi-faceted crystal geometry with internal glow
 * - Crystal clusters emerging from cave surfaces
 * - Enclosing rocky cave walls, ceiling, and floor
 * - Dark atmospheric cave void background
 * - Underground water pool with reflections
 * - Floating magical particles
 * - Stalactites and stalagmites
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { LightProbeGenerator } from 'three/examples/jsm/lights/LightProbeGenerator.js';
import { Water } from 'three/examples/jsm/objects/Water.js';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { CRYSTAL_CAVE_TETROMINOS } from './crystal-cave-tetrominos.js';

// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets
// ─────────────────────────────────────────────────────────────────────────────
const QUALITY_PRESETS = {
    Extreme: { crystalClusterCount: 45, particleCount: 3000, bloomStrength: 0.6, enablePost: true },
    Ultra: { crystalClusterCount: 35, particleCount: 2200, bloomStrength: 0.55, enablePost: true },
    High: { crystalClusterCount: 25, particleCount: 1500, bloomStrength: 0.5, enablePost: true },
    Medium: { crystalClusterCount: 15, particleCount: 1000, bloomStrength: 0.45, enablePost: false },
    Low: { crystalClusterCount: 8, particleCount: 500, bloomStrength: 0.35, enablePost: false },
    Minimal: { crystalClusterCount: 4, particleCount: 200, bloomStrength: 0.25, enablePost: false },
};

// ─────────────────────────────────────────────────────────────────────────────
// Crystal Color Palettes (preserved from original)
// ─────────────────────────────────────────────────────────────────────────────
const CRYSTAL_PALETTES = [
    { main: new THREE.Color(0xaa00ff), glow: new THREE.Color(0xaa00dd), light: new THREE.Color(0xaa00cc) }, // Deep Purple
    { main: new THREE.Color(0x00aa88), glow: new THREE.Color(0x00ffaa), light: new THREE.Color(0x00cc88) }, // Deep Teal
    { main: new THREE.Color(0x0044dd), glow: new THREE.Color(0x0066ff), light: new THREE.Color(0x0044aa) }, // Deep Blue
    { main: new THREE.Color(0xdd0066), glow: new THREE.Color(0xff0088), light: new THREE.Color(0xcc0066) }, // Deep Pink
    { main: new THREE.Color(0xff8800), glow: new THREE.Color(0xffaa00), light: new THREE.Color(0xcc6600) }, // Deep Gold
    { main: new THREE.Color(0x00aaaa), glow: new THREE.Color(0x00ffff), light: new THREE.Color(0x0088aa) }, // Deep Cyan
];

// ─────────────────────────────────────────────────────────────────────────────
// Shaders
// ─────────────────────────────────────────────────────────────────────────────

// Crystal Shader - Internal glow with faceted appearance
const CrystalShader = {
    vertexShader: `
        varying vec3 vNormal;
        varying vec3 vWorldPosition;
        varying vec3 vViewDir;
        varying float vHeight;
        varying vec3 vLocalPos;
        
        void main() {
            vNormal = normalize(normalMatrix * normal);
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPos.xyz;
            vViewDir = normalize(cameraPosition - worldPos.xyz);
            vHeight = position.y;
            vLocalPos = position;
            
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform float uTime;
        uniform float uPulseIntensity;
        uniform vec3 uMainColor;
        uniform vec3 uGlowColor;
        uniform vec3 uLightColor;
        
        varying vec3 vNormal;
        varying vec3 vWorldPosition;
        varying vec3 vViewDir;
        varying float vHeight;
        varying vec3 vLocalPos;
        
        void main() {
            // Pulsing animation
            float pulse = 0.6 + 0.4 * sin(uTime * 1.5 + vWorldPosition.x * 0.05 + vWorldPosition.z * 0.05);
            pulse *= (1.0 + uPulseIntensity * 2.5);
            
            // Sub-surface scattering - bright rim effect
            float rim = 1.0 - max(0.0, dot(vNormal, vViewDir));
            float sss = pow(rim, 2.0) * 1.0;
            
            // Internal glow - strongest at the core
            float distFromCenter = length(vLocalPos.xz);
            float coreGlow = exp(-distFromCenter * 0.15) * 0.8;
            
            // Height gradient - brighter toward tip
            float heightNorm = clamp(vHeight * 0.02 + 0.4, 0.0, 1.0);
            float internalGlow = heightNorm * 0.7 + coreGlow;
            
            // Fresnel for edge brightness
            float fresnel = pow(rim, 3.0);
            
            // Facet highlights based on normal direction
            vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
            float facetHighlight = max(0.0, dot(vNormal, lightDir));
            facetHighlight = pow(facetHighlight, 2.0) * 0.4;
            
            // Color blending - rich crystal colors
            vec3 color = uMainColor * 0.5; // Boost main color
            color = mix(color, uGlowColor, internalGlow * 0.8);
            color = mix(color, uLightColor, sss * 0.3); // Reduced SSS influence
            // Use colored fresnel instead of white
            color += uLightColor * fresnel * 0.4;
            color += uLightColor * facetHighlight;
            
            // Brightness calculation with pulse
            float brightness = (0.5 + internalGlow * 0.8 + sss * 0.4 + fresnel * 0.2) * pulse;
            
            gl_FragColor = vec4(color * brightness, 0.9);
        }
    `
};

// Cave Wall Shader - Rocky with bioluminescent veins
const CaveWallShader = {
    vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        
        void main() {
            vUv = uv;
            vNormal = normalMatrix * normal;
            vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        
        void main() {
            // Base rock color - dark purple/blue cave rock
            vec3 rock = vec3(0.03, 0.02, 0.05);
            
            // Add some variation based on position
            float variation = sin(vWorldPos.x * 0.02) * sin(vWorldPos.y * 0.03) * 0.02;
            rock += vec3(variation * 0.5, variation * 0.3, variation);
            
            // Glowing crystal veins
            float vein1 = sin(vUv.x * 15.0 + vUv.y * 8.0 + uTime * 0.15);
            float vein2 = sin(vUv.x * 6.0 - vUv.y * 12.0 - uTime * 0.1);
            float veins = pow(max(0.0, vein1 * vein2), 3.0);
            
            // Pulsing glow spots scattered across the wall
            float spots = sin(vUv.x * 20.0) * sin(vUv.y * 15.0 + uTime * 0.3);
            spots = pow(max(0.0, spots), 8.0) * (0.7 + 0.3 * sin(uTime * 1.5));
            
            vec3 color = rock;
            // Purple crystal veins
            color += vec3(0.25, 0.1, 0.4) * veins * 0.5;
            // Teal glow spots
            color += vec3(0.1, 0.35, 0.3) * spots * 0.6;
            
            gl_FragColor = vec4(color, 1.0);
        }
    `
};

// Cave Background Shader - Dark atmospheric void
const CaveBackgroundShader = {
    vertexShader: `
        varying vec3 vWorldPos;
        varying vec2 vUv;
        void main() {
            vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform float uTime;
        varying vec3 vWorldPos;
        varying vec2 vUv;
        
        void main() {
            float y = normalize(vWorldPos).y;
            float angle = atan(vWorldPos.x, vWorldPos.z);
            float time = uTime * 0.015;
            
            // Deep cave void - very dark purples and blues
            vec3 pureBlack = vec3(0.0, 0.0, 0.0);
            vec3 deepPurple = vec3(0.02, 0.01, 0.04);
            vec3 darkBlue = vec3(0.01, 0.02, 0.04);
            
            // Vertical gradient - darker at top (deeper cave)
            vec3 color = mix(deepPurple, pureBlack, smoothstep(-0.5, 0.8, y));
            
            // Very faint aurora-like crystal glow
            float aurora = sin(angle * 2.0 + y * 4.0 + time * 0.5);
            aurora = aurora * 0.5 + 0.5;
            aurora = pow(aurora, 6.0) * 0.04;
            aurora *= smoothstep(-0.2, 0.3, y) * smoothstep(0.7, 0.0, y);
            color += vec3(0.15, 0.05, 0.25) * aurora;
            
            // Subtle light pillars from below (crystal glow)
            float pillar = sin(angle * 5.0 + time * 0.15);
            pillar = pow(max(0.0, pillar), 16.0) * 0.03;
            pillar *= smoothstep(0.3, -0.5, y);
            color += vec3(0.1, 0.2, 0.25) * pillar;
            
            gl_FragColor = vec4(color, 1.0);
        }
    `
};

// Floating Particle Shader
const ParticleShader = {
    vertexShader: `
        attribute float aSize;
        attribute float aPhase;
        attribute float aSpeed;
        attribute vec3 aColor;
        
        uniform float uTime;
        
        varying float vAlpha;
        varying vec3 vColor;
        
        void main() {
            vec3 pos = position;
            
            // Gentle floating motion
            pos.y += sin(uTime * 0.4 + aPhase * 6.28) * 15.0;
            pos.x += sin(uTime * 0.25 + aPhase * 4.0) * 12.0;
            pos.z += cos(uTime * 0.3 + aPhase * 5.0) * 12.0;
            
            // Lifecycle fade
            vAlpha = 0.25 + 0.35 * sin(uTime * 0.6 + aPhase * 6.28);
            vColor = aColor;
            
            vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
            gl_PointSize = aSize * (250.0 / -mvPosition.z);
            gl_Position = projectionMatrix * mvPosition;
        }
    `,
    fragmentShader: `
        varying float vAlpha;
        varying vec3 vColor;
        
        void main() {
            vec2 coord = gl_PointCoord - 0.5;
            float dist = length(coord);
            if (dist > 0.5) discard;
            
            float glow = 1.0 - smoothstep(0.0, 0.5, dist);
            glow = pow(glow, 2.0);
            
            gl_FragColor = vec4(vColor * glow * 1.8, vAlpha * glow * 0.9);
        }
    `
};

// Water Pool Shader
const WaterShader = {
    vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldPosition;
        
        void main() {
            vUv = uv;
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPos.xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform float uTime;
        uniform float uReflectionStrength;
        
        varying vec2 vUv;
        varying vec3 vWorldPosition;
        
        void main() {
            // Animated ripples
            float ripple1 = sin(vUv.x * 25.0 + uTime * 0.6) * sin(vUv.y * 25.0 + uTime * 0.5) * 0.015;
            float ripple2 = sin(vUv.x * 18.0 - uTime * 0.4) * sin(vUv.y * 15.0 + uTime * 0.35) * 0.01;
            
            // Dark water base color with purple tint
            vec3 waterColor = vec3(0.02, 0.015, 0.04);
            
            // Crystal reflections (simulated)
            float dist = length(vUv - 0.5);
            float reflectionFade = smoothstep(0.6, 0.1, dist);
            vec3 reflectionColor = vec3(0.2, 0.1, 0.35) * uReflectionStrength * reflectionFade;
            
            // Shimmer highlights
            float shimmer = sin(vUv.x * 50.0 + uTime * 2.5) * sin(vUv.y * 40.0 - uTime * 2.0);
            shimmer = max(0.0, shimmer) * 0.12;
            
            vec3 color = waterColor + reflectionColor + vec3(shimmer * 0.3, shimmer * 0.2, shimmer * 0.5);
            
            // Edge fade
            float edgeFade = smoothstep(0.0, 0.15, min(vUv.x, min(vUv.y, min(1.0 - vUv.x, 1.0 - vUv.y))));
            
            gl_FragColor = vec4(color, 0.8 * edgeFade);
        }
    `
};

// Shockwave Ring Shader
const ShockwaveShader = {
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform float uOpacity;
        uniform vec3 uColor;
        varying vec2 vUv;
        
        void main() {
            vec2 center = vec2(0.5);
            float dist = length(vUv - center);
            
            float ring = smoothstep(0.35, 0.45, dist) * smoothstep(0.55, 0.45, dist);
            float innerGlow = smoothstep(0.5, 0.0, dist) * 0.25;
            
            float alpha = (ring + innerGlow) * uOpacity;
            
            gl_FragColor = vec4(uColor, alpha);
        }
    `
};

// ─────────────────────────────────────────────────────────────────────────────
// Theme Class
// ─────────────────────────────────────────────────────────────────────────────

export default class CrystalCaveTheme extends BaseTheme {
    constructor() {
        super('crystal-cave');
        this.eventUnsubscribers = [];

        // Three.js components
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.composer = null;
        this.mainGroup = null;
        this.crystalClusters = [];
        this.particles = null;
        this.waterPool = null;
        this.caveWalls = [];
        this.backgroundSphere = null;
        this.shockwaves = [];
        this.stalactites = [];
        this.stalagmites = [];
        this.lightProbes = [];

        // Animation
        this.animationFrame = null;
        this.clock = new THREE.Clock();

        // State
        this.uniforms = {
            time: { value: 0 },
            pulseIntensity: { value: 0 },
            reflectionStrength: { value: 0.3 },
        };

        this.currentQuality = 'High';
        this.activePreset = QUALITY_PRESETS.High;
    }

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    async createScene() {
        console.log('[CrystalCave] Initializing Three.js scene...');

        const container = document.getElementById('crystal-cave-theme');
        if (!container) {
            console.error('[CrystalCave] Container not found');
            return;
        }

        // Set quality
        const quality = this.getGraphicsQuality();
        this.activePreset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.High;
        this.currentQuality = quality;

        // Clean up
        container.innerHTML = '';

        // Scene setup
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x150a20, 0.001); // Lighter fog, reduced density

        // Camera - positioned inside the cave
        this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 2000);
        this.camera.position.set(0, 30, 120);
        this.camera.lookAt(0, 0, -50);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true,
            powerPreference: 'high-performance',
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.2;
        container.appendChild(this.renderer.domElement);

        // Post-processing
        if (this.activePreset.enablePost) {
            this.composer = new EffectComposer(this.renderer);
            this.composer.addPass(new RenderPass(this.scene, this.camera));

            const bloomPass = new UnrealBloomPass(
                new THREE.Vector2(window.innerWidth, window.innerHeight),
                this.activePreset.bloomStrength,
                0.5,
                0.8
            );
            this.composer.addPass(bloomPass);
        }

        // Main group for drift animation
        this.mainGroup = new THREE.Group();
        this.scene.add(this.mainGroup);

        // Generate textures
        this.caveRockTextures = this.createCaveRockPBRTextures();

        // Create scene elements
        this.createAtmosphericBackground();
        this.createCaveEnvironment();
        this.createCrystalClusters();
        this.createWaterPool();
        this.createParticles();
        this.setupLighting();
        this.createLightProbes();

        // Event listeners
        this.setupEventListeners();
        window.addEventListener('resize', this.onWindowResize.bind(this));

        // Start animation
        this.animate();

        console.log('[CrystalCave] Scene initialized with', this.crystalClusters.length, 'crystal clusters');
    }

    createAtmosphericBackground() {
        // Giant sphere for cave void background
        const bgGeo = new THREE.SphereGeometry(1500, 48, 32);
        const bgMat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
            },
            vertexShader: CaveBackgroundShader.vertexShader,
            fragmentShader: CaveBackgroundShader.fragmentShader,
            side: THREE.BackSide,
            fog: false,
        });
        this.backgroundSphere = new THREE.Mesh(bgGeo, bgMat);
        this.scene.add(this.backgroundSphere);
    }

    createCaveEnvironment() {
        // === BACK WALL ===
        const backWallGeo = new THREE.PlaneGeometry(800, 400, 32, 20);
        this.displaceGeometry(backWallGeo, 15);

        // Use MeshStandardMaterial for light probe support
        // with custom onBeforeCompile to add glowing veins
        const wallMat = this.createCaveWallMaterial();

        const backWall = new THREE.Mesh(backWallGeo, wallMat);
        backWall.position.set(0, 80, -250);
        this.mainGroup.add(backWall);
        this.caveWalls.push(backWall);

        // === CEILING ===
        const ceilingGeo = new THREE.PlaneGeometry(800, 500, 32, 32);
        this.displaceGeometry(ceilingGeo, 25);

        const ceiling = new THREE.Mesh(ceilingGeo, wallMat.clone());
        ceiling.rotation.x = Math.PI / 2;
        ceiling.position.set(0, 200, -50);
        this.mainGroup.add(ceiling);
        this.caveWalls.push(ceiling);

        // === FLOOR (rock around water) ===
        const floorGeo = new THREE.PlaneGeometry(800, 500, 64, 64);

        // Apply textures to materials
        const floorMat = new THREE.MeshStandardMaterial({
            map: this.caveRockTextures.colorMap,
            normalMap: this.caveRockTextures.normalMap,
            normalScale: new THREE.Vector2(2, 2),
            roughnessMap: this.caveRockTextures.roughnessMap,
            aoMap: this.caveRockTextures.aoMap,
            displacementMap: this.caveRockTextures.heightMap, // Use height map for displacement
            displacementScale: 15,
            emissiveMap: this.caveRockTextures.emissiveMap,
            emissive: 0x8040c0,
            emissiveIntensity: 0.2,
            envMapIntensity: 0.8,
            color: 0x302040, // Purple tint on top of texture
        });

        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.set(0, -60, -50);
        this.mainGroup.add(floor);
        this.caveWalls.push(floor);

        // === LEFT WALL ===
        const sideWallGeo = new THREE.PlaneGeometry(500, 350, 20, 20);
        this.displaceGeometry(sideWallGeo, 20);

        const leftWall = new THREE.Mesh(sideWallGeo, wallMat.clone());
        leftWall.rotation.y = Math.PI / 2;
        leftWall.position.set(-350, 70, -50);
        this.mainGroup.add(leftWall);
        this.caveWalls.push(leftWall);

        // === RIGHT WALL ===
        const rightWall = new THREE.Mesh(sideWallGeo.clone(), wallMat.clone());
        rightWall.rotation.y = -Math.PI / 2;
        rightWall.position.set(350, 70, -50);
        this.mainGroup.add(rightWall);
        this.caveWalls.push(rightWall);

        // === STALACTITES ===
        this.createStalactites();
    }

    displaceGeometry(geometry, amount) {
        const pos = geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const y = pos.getY(i);
            const noise = Math.sin(x * 0.03) * Math.cos(y * 0.04) * amount +
                Math.sin(x * 0.08 + y * 0.05) * (amount * 0.4);
            pos.setZ(i, noise);
        }
        geometry.computeVertexNormals();
    }

    /**
     * Create cave wall material that responds to light probes
     * Uses MeshStandardMaterial with custom shader injection for glowing veins
     */
    createCaveWallMaterial() {
        // Reuse generated textures if possible or mix with shader
        // For walls, we'll simpler material but with the textures
        const material = new THREE.MeshStandardMaterial({
            map: this.caveRockTextures.colorMap,
            normalMap: this.caveRockTextures.normalMap,
            normalScale: new THREE.Vector2(1.5, 1.5),
            roughnessMap: this.caveRockTextures.roughnessMap,
            aoMap: this.caveRockTextures.aoMap,
            color: 0x504060, // Much brighter base color
            roughness: 0.8,
            metalness: 0.1,
            emissive: 0x151025, // Stronger emissive
            emissiveIntensity: 0.4,
            envMapIntensity: 1.0,
        });

        return material;
    }

    createStalactites() {
        // Create rock stalactites hanging from ceiling
        const stalactiteCount = 25;
        const rockMat = new THREE.MeshStandardMaterial({
            color: 0x2a1835,  // Brighter purple-tinted rock
            roughness: 0.8,
            metalness: 0.05,
            emissive: 0x0a0510,
            emissiveIntensity: 0.2,
        });

        for (let i = 0; i < stalactiteCount; i++) {
            const height = 30 + Math.random() * 80;
            const radius = 3 + Math.random() * 8;

            const geo = new THREE.ConeGeometry(radius, height, 6);
            const stalactite = new THREE.Mesh(geo, rockMat);

            stalactite.position.set(
                (Math.random() - 0.5) * 600,
                195 - height / 2,
                (Math.random() - 0.5) * 400 - 50
            );
            stalactite.rotation.x = Math.PI;
            stalactite.rotation.z = (Math.random() - 0.5) * 0.15;

            this.mainGroup.add(stalactite);
            this.stalactites.push(stalactite);
        }

        // Stalagmites from floor
        const stalagmiteCount = 18;
        for (let i = 0; i < stalagmiteCount; i++) {
            const height = 15 + Math.random() * 45;
            const radius = 2 + Math.random() * 5;

            const geo = new THREE.ConeGeometry(radius, height, 6);
            const stalagmite = new THREE.Mesh(geo, rockMat);

            stalagmite.position.set(
                (Math.random() - 0.5) * 600,
                -55 + height / 2,
                (Math.random() - 0.5) * 400 - 50
            );
            stalagmite.rotation.z = (Math.random() - 0.5) * 0.1;

            this.mainGroup.add(stalagmite);
            this.stalagmites.push(stalagmite);
        }
    }

    // Create proper multi-faceted crystal geometry
    createCrystalGeometry(height, radius) {
        // Octahedral crystal with elongated shape
        const geometry = new THREE.BufferGeometry();

        const topPoint = height * 0.8;
        const midPoint = height * 0.35;
        const bottomPoint = -height * 0.2;

        // 6-sided crystal with pointed top and bottom
        const vertices = [];
        const normals = [];

        // Create hexagonal cross-section points
        const sides = 6;
        const points = [];
        for (let i = 0; i < sides; i++) {
            const angle = (i / sides) * Math.PI * 2;
            points.push({
                x: Math.cos(angle) * radius,
                z: Math.sin(angle) * radius
            });
        }

        // Build faces - top pyramid
        for (let i = 0; i < sides; i++) {
            const next = (i + 1) % sides;
            // Top face (pointing up)
            vertices.push(
                0, topPoint, 0,
                points[i].x, midPoint, points[i].z,
                points[next].x, midPoint, points[next].z
            );
        }

        // Middle body (hexagonal prism section)
        for (let i = 0; i < sides; i++) {
            const next = (i + 1) % sides;
            // Upper quad triangle 1
            vertices.push(
                points[i].x, midPoint, points[i].z,
                points[i].x * 0.9, 0, points[i].z * 0.9,
                points[next].x, midPoint, points[next].z
            );
            // Upper quad triangle 2
            vertices.push(
                points[next].x, midPoint, points[next].z,
                points[i].x * 0.9, 0, points[i].z * 0.9,
                points[next].x * 0.9, 0, points[next].z * 0.9
            );
        }

        // Bottom pyramid (smaller)
        for (let i = 0; i < sides; i++) {
            const next = (i + 1) % sides;
            vertices.push(
                points[i].x * 0.9, 0, points[i].z * 0.9,
                0, bottomPoint, 0,
                points[next].x * 0.9, 0, points[next].z * 0.9
            );
        }

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.computeVertexNormals();

        return geometry;
    }

    createCrystalCluster(x, y, z, surface) {
        const group = new THREE.Group();
        const palette = CRYSTAL_PALETTES[Math.floor(Math.random() * CRYSTAL_PALETTES.length)];
        const crystalCount = 6 + Math.floor(Math.random() * 8); // Increased count (6-14 crystals)

        for (let i = 0; i < crystalCount; i++) {
            const height = 15 + Math.random() * 40;
            const radius = 2 + Math.random() * 4;

            const geometry = this.createCrystalGeometry(height, radius);

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: this.uniforms.time,
                    uPulseIntensity: { value: 0 },
                    uMainColor: { value: palette.main.clone().multiplyScalar(0.8) }, // Rich colored base
                    uGlowColor: { value: palette.glow.clone().multiplyScalar(0.4) }, // Visible saturated glow
                    uLightColor: { value: palette.light.clone().multiplyScalar(0.7) },
                },
                vertexShader: CrystalShader.vertexShader,
                fragmentShader: CrystalShader.fragmentShader,
                transparent: true,
                side: THREE.DoubleSide,
                blending: THREE.NormalBlending, // Normal blending preserves deep colors
                depthWrite: true, // Proper depth sorting
            });

            const crystal = new THREE.Mesh(geometry, material);

            // Position within cluster
            const offsetAngle = (i / crystalCount) * Math.PI * 2 + Math.random() * 0.5;
            const offsetDist = Math.random() * 12;
            crystal.position.set(
                Math.cos(offsetAngle) * offsetDist,
                0,
                Math.sin(offsetAngle) * offsetDist
            );

            // Rotation based on surface type
            if (surface === 'ceiling') {
                crystal.rotation.x = Math.PI + (Math.random() - 0.5) * 0.4;
            } else if (surface === 'floor') {
                crystal.rotation.x = (Math.random() - 0.5) * 0.3;
            } else if (surface === 'left') {
                crystal.rotation.z = Math.PI / 2 + (Math.random() - 0.5) * 0.4;
            } else if (surface === 'right') {
                crystal.rotation.z = -Math.PI / 2 + (Math.random() - 0.5) * 0.4;
            } else if (surface === 'back') {
                crystal.rotation.x = Math.PI / 2 + (Math.random() - 0.5) * 0.4;
            }

            // Additional random tilt
            crystal.rotation.y = Math.random() * Math.PI * 2;
            crystal.rotation.z += (Math.random() - 0.5) * 0.25;

            group.add(crystal);
        }

        group.position.set(x, y, z);
        group.userData = {
            palette,
            phase: Math.random() * Math.PI * 2,
        };

        this.mainGroup.add(group);
        this.crystalClusters.push(group);
    }

    createCrystalClusters() {
        const count = this.activePreset.crystalClusterCount;

        // Ceiling clusters (stalactite-like)
        for (let i = 0; i < count * 0.35; i++) {
            this.createCrystalCluster(
                (Math.random() - 0.5) * 550,
                180 + Math.random() * 15,
                (Math.random() - 0.5) * 350 - 50,
                'ceiling'
            );
        }

        // Floor clusters (stalagmite-like)
        for (let i = 0; i < count * 0.25; i++) {
            this.createCrystalCluster(
                (Math.random() - 0.5) * 550,
                -55 + Math.random() * 10,
                (Math.random() - 0.5) * 350 - 50,
                'floor'
            );
        }

        // Back wall clusters
        for (let i = 0; i < count * 0.2; i++) {
            this.createCrystalCluster(
                (Math.random() - 0.5) * 500,
                (Math.random() - 0.3) * 200,
                -230 + Math.random() * 20,
                'back'
            );
        }

        // Left wall clusters
        for (let i = 0; i < count * 0.1; i++) {
            this.createCrystalCluster(
                -330 + Math.random() * 15,
                (Math.random() - 0.3) * 150,
                (Math.random() - 0.5) * 350 - 50,
                'left'
            );
        }

        // Right wall clusters
        for (let i = 0; i < count * 0.1; i++) {
            this.createCrystalCluster(
                330 - Math.random() * 15,
                (Math.random() - 0.3) * 150,
                (Math.random() - 0.5) * 350 - 50,
                'right'
            );
        }
    }

    createWaterPool() {
        const waterGeo = new THREE.PlaneGeometry(500, 350); // Larger pool

        // Use Three.js Water object for realistic rendering
        this.waterPool = new Water(waterGeo, {
            textureWidth: 512,
            textureHeight: 512,
            waterNormals: this.caveRockTextures.waterNormalMap, // Smoother water normals
            sunDirection: new THREE.Vector3(0, 1, 0),
            sunColor: 0xffffff,
            waterColor: 0x001e0f, // Deep dark teal/green
            distortionScale: 3.7,
            fog: this.scene.fog !== undefined
        });

        this.waterPool.rotation.x = -Math.PI / 2;
        this.waterPool.position.set(0, -58, 20);
        this.mainGroup.add(this.waterPool);
    }

    createParticles() {
        const count = this.activePreset.particleCount;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const phases = new Float32Array(count);
        const speeds = new Float32Array(count);
        const colors = new Float32Array(count * 3);

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;

            // Spread throughout cave interior
            positions[i3] = (Math.random() - 0.5) * 600;
            positions[i3 + 1] = (Math.random() - 0.3) * 220;
            positions[i3 + 2] = (Math.random() - 0.5) * 400 - 30;

            sizes[i] = 2 + Math.random() * 5;
            phases[i] = Math.random();
            speeds[i] = 0.4 + Math.random() * 1.2;

            // Random color from palette
            const palette = CRYSTAL_PALETTES[Math.floor(Math.random() * CRYSTAL_PALETTES.length)];
            colors[i3] = palette.glow.r;
            colors[i3 + 1] = palette.glow.g;
            colors[i3 + 2] = palette.glow.b;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
            },
            vertexShader: ParticleShader.vertexShader,
            fragmentShader: ParticleShader.fragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.particles = new THREE.Points(geometry, material);
        this.mainGroup.add(this.particles);
    }

    setupLighting() {
        // Brighter purple ambient for cave visibility
        const ambient = new THREE.AmbientLight(0x402060, 0.8);
        this.scene.add(ambient);

        // Hemisphere light for general cave illumination (sky = purple, ground = teal)
        const hemiLight = new THREE.HemisphereLight(0xa060e0, 0x60c0c0, 0.6);
        hemiLight.position.set(0, 100, 0);
        this.scene.add(hemiLight);

        // Helper to create non-decaying lights
        const createBrightLight = (color, intensity, dist, x, y, z) => {
            const light = new THREE.PointLight(color, intensity, dist, 0); // Decay = 0
            light.position.set(x, y, z);
            this.mainGroup.add(light);
            return light;
        };

        // Strong colored point lights to illuminate cave surfaces
        createBrightLight(0x8040c0, 1.5, 600, -100, 50, -50);
        createBrightLight(0x40ffc0, 1.2, 600, 100, 80, -100);
        createBrightLight(0x60a0ff, 1.2, 600, 0, -30, 50);

        // Additional crystal glow lights
        createBrightLight(0xff70b0, 0.8, 500, -150, 120, -100);
        createBrightLight(0xffc040, 0.8, 500, 150, -20, -80);

        // Floor illumination - point lights near ground level
        createBrightLight(0x8060ff, 1.0, 500, -100, -40, 0);
        createBrightLight(0x40ffa0, 1.0, 500, 100, -40, -60);

        // Strong central "Crystal Chandelier" light source
        const mainCrystalLight = new THREE.PointLight(0xffffff, 4.0, 1500, 0.5); // Decay 0.5
        mainCrystalLight.position.set(0, 100, 0);
        this.mainGroup.add(mainCrystalLight);
    }

    /**
     * Generate procedural PBR textures for cave rock
     */
    createCaveRockPBRTextures() {
        const SIZE = 256;
        const heightCanvas = document.createElement('canvas'); heightCanvas.width = SIZE; heightCanvas.height = SIZE;
        const normalCanvas = document.createElement('canvas'); normalCanvas.width = SIZE; normalCanvas.height = SIZE;
        const colorCanvas = document.createElement('canvas'); colorCanvas.width = SIZE; colorCanvas.height = SIZE;
        const roughnessCanvas = document.createElement('canvas'); roughnessCanvas.width = SIZE; roughnessCanvas.height = SIZE;
        const aoCanvas = document.createElement('canvas'); aoCanvas.width = SIZE; aoCanvas.height = SIZE;
        const emissiveCanvas = document.createElement('canvas'); emissiveCanvas.width = SIZE; emissiveCanvas.height = SIZE;
        const waterNormalCanvas = document.createElement('canvas'); waterNormalCanvas.width = SIZE; waterNormalCanvas.height = SIZE;

        const hCtx = heightCanvas.getContext('2d');
        const nCtx = normalCanvas.getContext('2d');
        const cCtx = colorCanvas.getContext('2d');
        const rCtx = roughnessCanvas.getContext('2d');
        const aCtx = aoCanvas.getContext('2d');
        const eCtx = emissiveCanvas.getContext('2d');
        const wnCtx = waterNormalCanvas.getContext('2d');

        // HEIGHT MAP - Bright mid-grey base
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, SIZE, SIZE);

        // Noise (used for both rock and water)
        for (let i = 0; i < 300; i++) {
            const x = Math.random() * SIZE;
            const y = Math.random() * SIZE;
            const r = 2 + Math.random() * 10;
            const b = 100 + Math.random() * 100;
            hCtx.fillStyle = `rgb(${b},${b},${b})`;
            hCtx.beginPath(); hCtx.arc(x, y, r, 0, Math.PI * 2); hCtx.fill();
        }

        // GENERATE WATER NORMAL MAP BEFORE ADDING CRACKS (Smoother)
        const generateNormalMap = (ctx, heightData) => {
            const nData = ctx.createImageData(SIZE, SIZE);
            const getH = (x, y) => {
                x = (x + SIZE) % SIZE; y = (y + SIZE) % SIZE;
                return heightData.data[(y * SIZE + x) * 4] / 255;
            };
            for (let y = 0; y < SIZE; y++) {
                for (let x = 0; x < SIZE; x++) {
                    const hL = getH(x - 1, y); const hR = getH(x + 1, y);
                    const hU = getH(x, y - 1); const hD = getH(x, y + 1);
                    const dx = (hL - hR) * 2.5;
                    const dy = (hU - hD) * 2.5;
                    let nz = 1.0;
                    const len = Math.sqrt(dx * dx + dy * dy + nz * nz);
                    const idx = (y * SIZE + x) * 4;
                    nData.data[idx] = ((dx / len) * 0.5 + 0.5) * 255;
                    nData.data[idx + 1] = ((dy / len) * 0.5 + 0.5) * 255;
                    nData.data[idx + 2] = (nz / len) * 255;
                    nData.data[idx + 3] = 255;
                }
            }
            ctx.putImageData(nData, 0, 0);
        };

        // Generate Water Normals (Noise only)
        generateNormalMap(wnCtx, hCtx.getImageData(0, 0, SIZE, SIZE));

        // ADD CRACKS TO HEIGHT MAP (For Rock)
        hCtx.strokeStyle = '#303030';
        hCtx.lineWidth = 2;
        for (let i = 0; i < 25; i++) {
            hCtx.beginPath();
            hCtx.moveTo(Math.random() * SIZE, Math.random() * SIZE);
            for (let j = 0; j < 6; j++) hCtx.lineTo(Math.random() * SIZE, Math.random() * SIZE);
            hCtx.stroke();
        }

        // Generate Rock Normals (Noise + Cracks)
        generateNormalMap(nCtx, hCtx.getImageData(0, 0, SIZE, SIZE));

        // COLOR MAP - MUCH BRIGHTER
        // Base: Lighter purple/grey
        cCtx.fillStyle = '#403550';
        cCtx.fillRect(0, 0, SIZE, SIZE);

        // Add color variations - Brighter crystals
        for (let i = 0; i < 60; i++) {
            const x = Math.random() * SIZE;
            const y = Math.random() * SIZE;
            const r = 20 + Math.random() * 60;
            const hue = Math.random() > 0.5 ? 280 : 170; // Purple or Teal
            // Much brighter dots: Lightness 50%, alpha 0.4
            cCtx.fillStyle = `hsla(${hue}, 60%, 50%, 0.4)`;
            cCtx.beginPath(); cCtx.arc(x, y, r, 0, Math.PI * 2); cCtx.fill();
        }

        // Add some brighter speckles
        for (let i = 0; i < 100; i++) {
            const x = Math.random() * SIZE;
            const y = Math.random() * SIZE;
            cCtx.fillStyle = 'rgba(200, 200, 255, 0.3)';
            cCtx.fillRect(x, y, 2, 2);
        }

        // OTHERS
        rCtx.fillStyle = '#a0a0a0'; rCtx.fillRect(0, 0, SIZE, SIZE); // Rough
        aCtx.fillStyle = '#ffffff'; aCtx.fillRect(0, 0, SIZE, SIZE); // No AO bake details for now
        eCtx.fillStyle = '#000000'; eCtx.fillRect(0, 0, SIZE, SIZE); // No static emissive

        // Helper to repeat
        const wrap = (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(8, 8); return t; };

        return {
            heightMap: wrap(new THREE.CanvasTexture(heightCanvas)),
            normalMap: wrap(new THREE.CanvasTexture(normalCanvas)),
            waterNormalMap: wrap(new THREE.CanvasTexture(waterNormalCanvas)),
            colorMap: wrap(new THREE.CanvasTexture(colorCanvas)),
            roughnessMap: wrap(new THREE.CanvasTexture(roughnessCanvas)),
            aoMap: wrap(new THREE.CanvasTexture(aoCanvas)),
            emissiveMap: wrap(new THREE.CanvasTexture(emissiveCanvas))
        };
    }

    /**
     * Create Light Probes for Global Illumination
     * Uses Spherical Harmonics to capture crystal glow colors at probe positions
     */
    createLightProbes() {
        // Generate SH coefficients for each crystal palette color
        // These approximate the ambient light contribution from crystals
        const probePositions = [
            // Center area probes
            { pos: new THREE.Vector3(0, 50, 0), palette: CRYSTAL_PALETTES[0] },
            { pos: new THREE.Vector3(0, -20, 30), palette: CRYSTAL_PALETTES[1] },
            // Ceiling probes
            { pos: new THREE.Vector3(-100, 150, -80), palette: CRYSTAL_PALETTES[0] },
            { pos: new THREE.Vector3(100, 150, -80), palette: CRYSTAL_PALETTES[2] },
            { pos: new THREE.Vector3(0, 170, -50), palette: CRYSTAL_PALETTES[5] },
            // Floor probes
            { pos: new THREE.Vector3(-80, -40, 0), palette: CRYSTAL_PALETTES[1] },
            { pos: new THREE.Vector3(80, -40, 0), palette: CRYSTAL_PALETTES[3] },
            // Wall probes
            { pos: new THREE.Vector3(-250, 60, -100), palette: CRYSTAL_PALETTES[4] },
            { pos: new THREE.Vector3(250, 60, -100), palette: CRYSTAL_PALETTES[2] },
            // Back area probes
            { pos: new THREE.Vector3(0, 80, -180), palette: CRYSTAL_PALETTES[0] },
            { pos: new THREE.Vector3(-150, 100, -150), palette: CRYSTAL_PALETTES[5] },
            { pos: new THREE.Vector3(150, 100, -150), palette: CRYSTAL_PALETTES[1] },
        ];

        probePositions.forEach(({ pos, palette }) => {
            const probe = this.createCrystalLightProbe(palette, 0.35);  // Increased from 0.15
            probe.position.copy(pos);
            this.scene.add(probe);
            this.lightProbes.push(probe);
        });

        console.log('[CrystalCave] Created', this.lightProbes.length, 'light probes for global illumination');
    }

    /**
     * Create a LightProbe with SH coefficients based on crystal color
     * @param {Object} palette - Crystal color palette with glow color
     * @param {number} intensity - Light intensity multiplier
     */
    createCrystalLightProbe(palette, intensity = 0.2) {
        const probe = new THREE.LightProbe();

        // Generate SH coefficients manually based on crystal glow color
        // Using L0 (ambient) and L1 (directional) bands
        const color = palette.glow;
        const r = color.r * intensity;
        const g = color.g * intensity;
        const b = color.b * intensity;

        // Create spherical harmonics coefficients
        // L0 band (uniform ambient) - coefficients 0-2
        // L1 band (directional) - coefficients 3-11
        // L2 band (more directional detail) - coefficients 12-26

        // For cave lighting, we mainly want soft ambient glow
        // Using simplified SH3 (9 coefficients per color channel)
        const sh = probe.sh.coefficients;

        // L0 - uniform ambient light (main contribution)
        sh[0].set(r * 0.886, g * 0.886, b * 0.886);

        // L1 - directional components (subtle)
        sh[1].set(r * 0.1, g * 0.1, b * 0.1);  // y direction
        sh[2].set(r * 0.05, g * 0.05, b * 0.05); // z direction
        sh[3].set(r * 0.05, g * 0.05, b * 0.05); // x direction

        // L2 - higher order (subtle secondary bounce feel)
        sh[4].set(r * 0.02, g * 0.02, b * 0.02);
        sh[5].set(r * 0.02, g * 0.02, b * 0.02);
        sh[6].set(r * 0.01, g * 0.01, b * 0.01);
        sh[7].set(r * 0.01, g * 0.01, b * 0.01);
        sh[8].set(r * 0.01, g * 0.01, b * 0.01);

        return probe;
    }

    setupEventListeners() {
        const settings = typeof window !== 'undefined' ? window.settings : null;

        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            if (settings?.backgroundComboEffects !== false) {
                this.onLineClear(data.lineCount || 1);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            if (settings?.backgroundComboEffects !== false) {
                this.onCombo(data.comboCount || data.count || 1);
            }
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
            if (settings?.backgroundComboEffects !== false) {
                this.onPieceLock();
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
    }

    onLineClear(lineCount) {
        // Flash crystal clusters
        const flashCount = Math.min(lineCount * 3, 10);
        for (let i = 0; i < flashCount && i < this.crystalClusters.length; i++) {
            const cluster = this.crystalClusters[Math.floor(Math.random() * this.crystalClusters.length)];
            cluster.children.forEach(crystal => {
                if (crystal.material?.uniforms?.uPulseIntensity) {
                    crystal.material.uniforms.uPulseIntensity.value = 0.8 + lineCount * 0.15;
                }
            });
        }

        // Water reflection boost
        this.uniforms.reflectionStrength.value = 0.6 + lineCount * 0.1;

        // Shockwave for big clears
        if (lineCount >= 2) {
            this.createShockwave(lineCount);
        }
    }

    onCombo(comboCount) {
        // Intense crystal pulses
        this.crystalClusters.forEach(cluster => {
            cluster.children.forEach(crystal => {
                if (crystal.material?.uniforms?.uPulseIntensity) {
                    // Make ALL crystals pulse on combo
                    crystal.material.uniforms.uPulseIntensity.value = 1.2 + comboCount * 0.3;
                }
            });
        });

        // Shockwave
        this.createShockwave(comboCount);

        // Particle Burst
        this.createComboBurst(comboCount);

        // Lightning Arcs
        if (this.crystalClusters.length > 1) {
            const arcCount = Math.min(comboCount, 5);
            for (let i = 0; i < arcCount; i++) {
                const c1 = this.crystalClusters[Math.floor(Math.random() * this.crystalClusters.length)];
                const c2 = this.crystalClusters[Math.floor(Math.random() * this.crystalClusters.length)];
                if (c1 !== c2) {
                    this.createLightningArc(c1.position, c2.position);
                }
            }
        }
    }

    onPieceLock() {
        // Small crystal pulse - flash multiple clusters
        const flashCount = Math.min(5, this.crystalClusters.length);
        for (let i = 0; i < flashCount; i++) {
            const cluster = this.crystalClusters[Math.floor(Math.random() * this.crystalClusters.length)];
            cluster.children.forEach(crystal => {
                if (crystal.material?.uniforms?.uPulseIntensity) {
                    crystal.material.uniforms.uPulseIntensity.value = 1.2; // Strong flash on lock
                }
            });
        }
    }

    createShockwave(intensity) {
        const palette = CRYSTAL_PALETTES[Math.floor(Math.random() * CRYSTAL_PALETTES.length)];

        const geometry = new THREE.PlaneGeometry(1, 1);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uOpacity: { value: 0.7 },
                uColor: { value: palette.glow.clone() },
            },
            vertexShader: ShockwaveShader.vertexShader,
            fragmentShader: ShockwaveShader.fragmentShader,
            transparent: true,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        const shockwave = new THREE.Mesh(geometry, material);
        shockwave.position.set(0, 10, 40);
        shockwave.userData = {
            life: 1.0,
            maxLife: 1.0,
            speed: 25 + intensity * 12,
            maxScale: 80 + intensity * 25,
        };

        this.mainGroup.add(shockwave);
        this.shockwaves.push(shockwave);
    }

    createComboBurst(intensity) {
        const count = 30 + intensity * 10;
        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const velocities = [];
        const colors = [];

        const palette = CRYSTAL_PALETTES[Math.floor(Math.random() * CRYSTAL_PALETTES.length)];
        const color = palette.glow;

        for (let i = 0; i < count; i++) {
            // Start from center
            positions.push(0, 0, 0);

            // Explosion velocity
            const speed = 15 + Math.random() * 20 + intensity * 5;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.random() * Math.PI;

            velocities.push(
                Math.sin(phi) * Math.cos(theta) * speed,
                Math.sin(phi) * Math.sin(theta) * speed,
                Math.cos(phi) * speed
            );

            // Varied colors (White/Gold for high combo)
            if (intensity > 3 && Math.random() > 0.5) {
                colors.push(1, 0.9, 0.6); // Gold
            } else {
                colors.push(color.r, color.g, color.b);
            }
        }

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

        const material = new THREE.PointsMaterial({
            size: 1.5 + intensity * 0.2,
            vertexColors: true,
            transparent: true,
            opacity: 1,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        const burst = new THREE.Points(geometry, material);
        burst.userData = { velocities: velocities, life: 1.0 };
        this.mainGroup.add(burst);

        // Track for animation
        if (!this.comboBursts) this.comboBursts = [];
        this.comboBursts.push(burst);
    }

    createLightningArc(start, end) {
        const points = [];
        const segments = 12;
        const dir = new THREE.Vector3().subVectors(end, start);
        const len = dir.length();

        points.push(start);

        for (let i = 1; i < segments; i++) {
            const t = i / segments;
            const pos = new THREE.Vector3().lerpVectors(start, end, t);

            // Jagged offset
            const offset = (Math.random() - 0.5) * (len * 0.15); // 15% of length variance
            pos.x += (Math.random() - 0.5) * 10;
            pos.y += (Math.random() - 0.5) * 10;
            pos.z += (Math.random() - 0.5) * 10;

            points.push(pos);
        }
        points.push(end);

        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({
            color: 0x88ffff, // Cyan/White electricity
            transparent: true,
            opacity: 1,
            linewidth: 2, // Only works on some renderers
            blending: THREE.AdditiveBlending
        });

        const bolt = new THREE.Line(geometry, material);
        bolt.userData = { life: 0.4 }; // Short life

        this.mainGroup.add(bolt);
        if (!this.lightningBolts) this.lightningBolts = [];
        this.lightningBolts.push(bolt);
    }

    animate() {
        if (!this.isActive) return;

        this.animationFrame = requestAnimationFrame(this.animate.bind(this));

        const delta = this.clock.getDelta();
        const elapsed = this.clock.getElapsedTime();
        this.uniforms.time.value = elapsed;

        // Gentle scene drift
        if (this.mainGroup) {
            const driftSpeed = 0.08;
            this.mainGroup.position.x = Math.sin(elapsed * driftSpeed) * 8;
            this.mainGroup.position.y = Math.cos(elapsed * driftSpeed * 0.6) * 4;
            this.mainGroup.rotation.y = Math.sin(elapsed * 0.04) * 0.03;
        }

        // Update crystal pulse decay
        this.crystalClusters.forEach(cluster => {
            cluster.children.forEach(crystal => {
                if (crystal.material?.uniforms?.uPulseIntensity) {
                    if (crystal.material.uniforms.uPulseIntensity.value > 0) {
                        crystal.material.uniforms.uPulseIntensity.value *= 0.96;
                    }
                }
            });
        });

        // Update water animation
        if (this.waterPool && this.waterPool.material && this.waterPool.material.uniforms) {
            this.waterPool.material.uniforms['time'].value += delta;
        }

        // Update shockwaves
        this.updateShockwaves(delta);

        // Update combo particle bursts
        if (this.comboBursts) {
            this.updateComboBursts(delta);
        }

        // Update lightning
        if (this.lightningBolts) {
            this.updateLightning(delta);
        }

        // Render
        if (this.composer) {
            this.composer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    updateComboBursts(delta) {
        for (let i = this.comboBursts.length - 1; i >= 0; i--) {
            const burst = this.comboBursts[i];
            const positions = burst.geometry.attributes.position.array;
            const velocities = burst.userData.velocities;

            burst.userData.life -= delta;

            // Move particles
            for (let j = 0; j < positions.length / 3; j++) {
                positions[j * 3] += velocities[j * 3] * delta;
                positions[j * 3 + 1] += velocities[j * 3 + 1] * delta;
                positions[j * 3 + 2] += velocities[j * 3 + 2] * delta;

                // Gravity
                velocities[j * 3 + 1] -= 20 * delta;
            }
            burst.geometry.attributes.position.needsUpdate = true;

            // Fade out
            burst.material.opacity = burst.userData.life;

            if (burst.userData.life <= 0) {
                this.mainGroup.remove(burst);
                burst.geometry.dispose();
                burst.material.dispose();
                this.comboBursts.splice(i, 1);
            }
        }
    }

    updateLightning(delta) {
        for (let i = this.lightningBolts.length - 1; i >= 0; i--) {
            const bolt = this.lightningBolts[i];
            bolt.userData.life -= delta;

            // Provide a flicker effect
            bolt.material.opacity = bolt.userData.life * (Math.random() > 0.5 ? 1.0 : 0.5);

            if (bolt.userData.life <= 0) {
                this.mainGroup.remove(bolt);
                bolt.geometry.dispose();
                bolt.material.dispose();
                this.lightningBolts.splice(i, 1);
            }
        }
    }

    updateShockwaves(delta) {
        for (let i = this.shockwaves.length - 1; i >= 0; i--) {
            const wave = this.shockwaves[i];
            wave.userData.life -= delta * 1.5;

            const progress = 1 - (wave.userData.life / wave.userData.maxLife);
            const scale = progress * wave.userData.maxScale;
            wave.scale.set(scale, scale, 1);

            wave.material.uniforms.uOpacity.value = wave.userData.life;

            if (wave.userData.life <= 0) {
                this.mainGroup.remove(wave);
                wave.geometry.dispose();
                wave.material.dispose();
                this.shockwaves.splice(i, 1);
            }
        }
    }

    onWindowResize() {
        if (!this.camera || !this.renderer) return;

        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);

        if (this.composer) {
            this.composer.setSize(window.innerWidth, window.innerHeight);
        }
    }

    stop() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }

        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];

        window.removeEventListener('resize', this.onWindowResize.bind(this));

        // Cleanup Three.js
        if (this.renderer) {
            this.renderer.dispose();
            const container = document.getElementById('crystal-cave-theme');
            if (container && container.contains(this.renderer.domElement)) {
                container.removeChild(this.renderer.domElement);
            }
        }

        if (this.composer) {
            this.composer.dispose();
        }

        // Dispose scene objects
        if (this.scene) {
            this.scene.traverse((object) => {
                if (object.geometry) object.geometry.dispose();
                if (object.material) {
                    if (Array.isArray(object.material)) {
                        object.material.forEach((m) => m.dispose());
                    } else {
                        object.material.dispose();
                    }
                }
            });
        }

        this.crystalClusters = [];
        this.shockwaves = [];
        this.comboBursts = [];
        this.lightningBolts = [];
        this.stalactites = [];
        this.stalagmites = [];
        this.caveWalls = [];
        this.lightProbes = [];
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.composer = null;
        this.mainGroup = null;

        super.stop();
    }

    getTetrominoConfig() {
        return CRYSTAL_CAVE_TETROMINOS;
    }
}
