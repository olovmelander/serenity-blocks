/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  🌾 SUMMER MEADOW 🌾
 *  A Beautiful 3D Summer Theme with Realistic Grass Rendering
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Inspired by "Realistic real-time grass rendering" by Eddie Lee
 * Features smooth wind animation and translucent grass lighting
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { SUMMER_TETROMINOS } from './summer-tetrominos.js';

// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets
// ─────────────────────────────────────────────────────────────────────────────
const QUALITY_PRESETS = {
    Ultra: {
        grassInstances: 350000, butterflyCount: 12, bumblebeeCount: 8, pollenCount: 80, bloomStrength: 0.12,
    },
    High: {
        grassInstances: 250000, butterflyCount: 10, bumblebeeCount: 6, pollenCount: 60, bloomStrength: 0.1,
    },
    Medium: {
        grassInstances: 150000, butterflyCount: 6, bumblebeeCount: 4, pollenCount: 40, bloomStrength: 0.08,
    },
    Low: {
        grassInstances: 80000, butterflyCount: 4, bumblebeeCount: 2, pollenCount: 20, bloomStrength: 0.05,
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Sky Shader - Clean blue summer sky
// ─────────────────────────────────────────────────────────────────────────────
const SkyShader = {
    vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPos.xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform vec3 uSunDirection;
        varying vec3 vWorldPosition;
        
        void main() {
            vec3 rayDir = normalize(vWorldPosition);
            float y = max(0.0, rayDir.y);
            
            // Deep summer blue sky
            vec3 zenithColor = vec3(0.05, 0.25, 0.7);   // Deep cobalt blue
            vec3 horizonColor = vec3(0.35, 0.55, 0.85); // Medium blue horizon
            
            // Smooth gradient
            float t = pow(y, 0.35);
            vec3 col = mix(horizonColor, zenithColor, t);
            
            // Minimal haze - keep sky blue
            vec3 hazeColor = vec3(0.9, 0.85, 0.7);
            col = mix(col, hazeColor, pow(1.0 - y, 12.0) * 0.1);
            
            // Very subtle atmospheric glow only (sun is rendered as 3D object)
            vec3 sunDir = normalize(uSunDirection);
            float mu = max(0.0, dot(sunDir, rayDir));
            col += vec3(1.0, 0.9, 0.7) * pow(mu, 4.0) * 0.03;    // Very subtle warm haze only
            
            // Gamma only - no tonemapping to preserve blue
            col = pow(col, vec3(0.4545));
            
            gl_FragColor = vec4(col, 1.0);
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Grass Shader - Instanced with wind and translucency
// ─────────────────────────────────────────────────────────────────────────────
const GrassShader = {
    vertexShader: `
        attribute vec3 offset;
        attribute float bladeHeight;
        attribute float bladePhase;
        attribute float bladeIndex;
        
        uniform float uTime;
        uniform float uWindStrength;
        
        varying vec3 vNormal;
        varying vec3 vPosition;
        varying float vHeight;
        varying float vIndex;
        
        const float PI = 3.14159265;
        
        void main() {
            vHeight = uv.y;
            vIndex = bladeIndex;
            
            // Scale blade
            vec3 pos = position;
            pos.y *= bladeHeight;
            
            // Taper blade - critical for high res look
            // Makes the blade pointed at the top instead of a rectangle
            float taper = 1.0 - pow(uv.y, 2.0);
            pos.x *= taper;
            
            // Wind - smooth waves based on position and time
            float t = vHeight; // Height fraction
            vec2 windCoord = offset.xz * 0.03;
            
            float windWave = sin(windCoord.x * PI * 2.0 + uTime * 1.5) * 0.5 + 0.5;
            windWave *= cos(windCoord.y * PI * 2.0 + uTime * 1.2) * 0.5 + 0.5;
            
            // Bend increases quadratically toward tip
            float bendAmount = windWave * 0.3 * uWindStrength * t * t;
            
            // Apply bend
            float cosB = cos(bendAmount);
            float sinB = sin(bendAmount);
            
            vec3 bent = pos;
            bent.y = pos.y * cosB;
            bent.z = pos.y * sinB;
            
            // Side sway
            float sway = sin(uTime * 2.0 + bladePhase) * t * t * 0.1 * uWindStrength;
            bent.x += sway;
            
            // World position
            vec3 worldPos = bent + offset;
            vPosition = worldPos;
            
            // Normal
            vNormal = normalize(vec3(sinB * 0.3, cosB, 0.0));
            
            gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPos, 1.0);
        }
    `,
    fragmentShader: `
        uniform vec3 uSunDirection;
        
        varying vec3 vNormal;
        varying vec3 vPosition;
        varying float vHeight;
        varying float vIndex;
        
        vec3 ACESFilm(vec3 x) {
            float a = 2.51;
            float b = 0.03;
            float c = 2.43;
            float d = 0.59;
            float e = 0.14;
            return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
        }
        
        void main() {
            vec3 normal = gl_FrontFacing ? normalize(vNormal) : normalize(-vNormal);
            
            // Rich dark green gradient
            vec3 rootColor = vec3(0.01, 0.08, 0.005);    // Very dark green root
            vec3 midColor = vec3(0.04, 0.25, 0.02);      // Dark grass green
            vec3 tipColor = vec3(0.15, 0.40, 0.05);      // Darker green tip
            
            // Color variation for natural look
            vec3 altColor = vIndex > 0.5 ? vec3(0.035, 0.22, 0.012) : vec3(0.08, 0.30, 0.025);
            
            vec3 grassColor = mix(rootColor, midColor, smoothstep(0.0, 0.35, vHeight));
            grassColor = mix(grassColor, tipColor, smoothstep(0.35, 1.0, vHeight));
            grassColor = mix(altColor, grassColor, 0.7);
            
            // Lighting
            vec3 sunDir = normalize(uSunDirection);
            vec3 sunColor = vec3(1.0, 0.95, 0.9);
            
            // Diffuse
            float diff = max(dot(normal, sunDir), 0.0);
            
            // Sky light
            float sky = max(dot(normal, vec3(0.0, 1.0, 0.0)), 0.0);
            vec3 skyLight = sky * vec3(0.1, 0.2, 0.4);
            
            // Translucency
            vec3 trans = vec3(0.0);
            float dotNL = dot(normal, sunDir);
            if (dotNL < 0.0) {
                trans = grassColor * sunColor * (-dotNL) * 0.5;
            }
            
            // Combine
            vec3 col = grassColor * 0.25;              // Ambient
            col += diff * grassColor * sunColor * 0.6; // Diffuse
            col += skyLight * grassColor * 0.25;       // Sky
            col += trans;                              // Translucency
            
            // AO at root
            float ao = smoothstep(0.0, 0.3, vHeight);
            col *= 0.4 + 0.6 * ao;
            
            col = ACESFilm(col);
            col = pow(col, vec3(0.4545));
            
            gl_FragColor = vec4(col, 1.0);
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Sun Shader
// ─────────────────────────────────────────────────────────────────────────────
const SunShader = {
    vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
            vNormal = normalize(normalMatrix * normal);
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            vViewDir = normalize(cameraPosition - worldPos.xyz);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform float uTime;
        uniform float uPulse;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        
        void main() {
            float rim = 1.0 - max(0.0, dot(vNormal, vViewDir));
            float pulse = 0.95 + 0.05 * sin(uTime * 1.5);
            pulse *= (1.0 + uPulse * 0.2);
            
            // Bright shiny sun - no dark edges
            vec3 sunColor = vec3(1.0, 0.95, 0.75);  // Warm white-yellow
            
            // Slight limb darkening but stay bright
            float limbFactor = 1.0 - pow(rim, 2.0) * 0.1;
            
            // Bright center glow
            float centerGlow = 1.0 + pow(1.0 - rim, 2.0) * 0.5;
            
            float brightness = pulse * limbFactor * centerGlow * 1.2;
            
            gl_FragColor = vec4(sunColor * brightness, 1.0);
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Theme Class
// ─────────────────────────────────────────────────────────────────────────────
export default class SummerTheme extends BaseTheme {
    constructor() {
        super('summer');

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.composer = null;
        this.clock = new THREE.Clock();
        this.time = 0;

        // Scene elements
        this.sun = null;
        this.sunGlowLayers = [];
        this.grass = null;
        this.butterflies = [];
        this.bumblebees = [];
        this.pollen = null;

        // Effect states
        this.pulseIntensity = 0;
        this.targetPulse = 0;
        this.windStrength = 1.0;
        this.targetWind = 1.0;

        // Sun direction
        // Sun direction - slightly lower for better visibility
        this.sunDirection = new THREE.Vector3(0.4, 0.3, -0.8).normalize();

        this.eventUnsubscribers = [];
        this.qualityPreset = QUALITY_PRESETS.High;
        this.animationFrameId = null;
    }

    getTetrominoConfig() {
        return SUMMER_TETROMINOS;
    }

    async createScene() {
        const container = document.getElementById('summer-theme');
        if (!container) {
            console.error('[SummerTheme] Container not found');
            return;
        }

        console.log('[SummerTheme] Creating summer meadow scene...');

        this.initRenderer(container);
        this.createSky();
        this.createSun();
        this.createGround();
        this.createGrass();
        this.createButterflies();
        this.createBumblebees();
        this.createPollen();
        this.setupPostProcessing();
        this.setupEventListeners();
        this.startAnimationLoop();

        console.log('[SummerTheme] Scene created successfully');
    }

    initRenderer(container) {
        const w = window.innerWidth;
        const h = window.innerHeight;

        this.renderer = new THREE.WebGLRenderer({ antialias: this.getAntialiasEnabled(), alpha: false });
        this.renderer.setSize(w, h);
        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        // No tonemapping - keep colors vivid
        this.renderer.toneMapping = THREE.NoToneMapping;
        container.innerHTML = '';
        container.appendChild(this.renderer.domElement);
        this.registerContainer(container);

        this.scene = new THREE.Scene();
        // No fog - keep sky blue

        // Camera positioned lower for immersive grass view
        this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 5000);
        this.camera.position.set(0, 6, 55);
        this.camera.lookAt(0, 2, -30);

        // Lights
        const sunLight = new THREE.DirectionalLight(0xFFFAF0, 1.0);
        sunLight.position.copy(this.sunDirection).multiplyScalar(100);
        this.scene.add(sunLight);

        const ambientLight = new THREE.AmbientLight(0xD0E8F0, 0.4);
        this.scene.add(ambientLight);

        const hemiLight = new THREE.HemisphereLight(0x88BBEE, 0x228833, 0.5);
        this.scene.add(hemiLight);
    }

    createSky() {
        const geometry = new THREE.SphereGeometry(2000, 32, 32);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uSunDirection: { value: this.sunDirection },
            },
            vertexShader: SkyShader.vertexShader,
            fragmentShader: SkyShader.fragmentShader,
            side: THREE.BackSide,
        });
        const sky = new THREE.Mesh(geometry, material);
        this.scene.add(sky);
    }

    createSun() {
        const sunSize = 45; // Larger sun
        const geometry = new THREE.SphereGeometry(sunSize, 32, 32);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uPulse: { value: 0 },
            },
            vertexShader: SunShader.vertexShader,
            fragmentShader: SunShader.fragmentShader,
        });

        this.sun = new THREE.Mesh(geometry, material);
        this.sun.position.copy(this.sunDirection).multiplyScalar(800);
        this.scene.add(this.sun);

        // Create soft glow sprite (better than spheres)
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        gradient.addColorStop(0, 'rgba(255, 250, 220, 0.8)'); // Center (reduced opacity)
        gradient.addColorStop(0.2, 'rgba(255, 200, 50, 0.3)'); // Halo (significantly reduced opacity)
        gradient.addColorStop(0.5, 'rgba(255, 140, 20, 0.08)'); // Edge (subtle)
        gradient.addColorStop(1, 'rgba(255, 120, 0, 0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 128, 128);

        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({
            map: texture,
            color: 0xffffff,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.scale.set(sunSize * 6, sunSize * 6, 1);
        this.sun.add(sprite);
        this.sunGlowLayers.push(sprite);

        // Lens flare / God ray simulation (widescreen sprite)
        const flareSprite = new THREE.Sprite(spriteMaterial.clone());
        flareSprite.scale.set(sunSize * 15, sunSize * 8, 1);
        flareSprite.material.opacity = 0.3;
        this.sun.add(flareSprite);
        this.sunGlowLayers.push(flareSprite);
    }

    createGround() {
        // Create curved ground - compact area for dense grass
        const geometry = new THREE.PlaneGeometry(200, 150, 64, 64);

        // Apply hill curve to match grass
        const positions = geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i);
            const y = positions.getY(i); // z in world space

            const distFromCenter = Math.sqrt(x * x + (y + 20) * (y + 20));
            const hillHeight = Math.cos(distFromCenter * 0.012) * 5 - 4; // Slightly lower than grass

            positions.setZ(i, hillHeight);
        }
        geometry.computeVertexNormals();

        // Create procedural grass textures
        const texSize = 512;

        // === COLOR/ALBEDO MAP ===
        const colorCanvas = document.createElement('canvas');
        colorCanvas.width = texSize;
        colorCanvas.height = texSize;
        const colorCtx = colorCanvas.getContext('2d');

        // Base dark green
        colorCtx.fillStyle = '#0a1c08';
        colorCtx.fillRect(0, 0, texSize, texSize);

        // Add grass blade patterns
        for (let i = 0; i < 8000; i++) {
            const x = Math.random() * texSize;
            const y = Math.random() * texSize;
            const length = 3 + Math.random() * 12;
            const width = 0.5 + Math.random() * 1.5;
            const angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.6;

            // Vary the green color
            const greenVal = 40 + Math.floor(Math.random() * 80);
            const redVal = Math.floor(greenVal * 0.2);
            colorCtx.strokeStyle = `rgb(${redVal}, ${greenVal}, ${Math.floor(greenVal * 0.15)})`;
            colorCtx.lineWidth = width;
            colorCtx.lineCap = 'round';

            colorCtx.beginPath();
            colorCtx.moveTo(x, y);
            colorCtx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
            colorCtx.stroke();
        }

        // Add some darker patches for depth
        for (let i = 0; i < 50; i++) {
            const x = Math.random() * texSize;
            const y = Math.random() * texSize;
            const radius = 10 + Math.random() * 30;
            const gradient = colorCtx.createRadialGradient(x, y, 0, x, y, radius);
            gradient.addColorStop(0, 'rgba(5, 15, 5, 0.4)');
            gradient.addColorStop(1, 'rgba(5, 15, 5, 0)');
            colorCtx.fillStyle = gradient;
            colorCtx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        }

        const colorTexture = new THREE.CanvasTexture(colorCanvas);
        colorTexture.wrapS = THREE.RepeatWrapping;
        colorTexture.wrapT = THREE.RepeatWrapping;
        colorTexture.repeat.set(12, 10);

        // === NORMAL MAP ===
        const normalCanvas = document.createElement('canvas');
        normalCanvas.width = texSize;
        normalCanvas.height = texSize;
        const normalCtx = normalCanvas.getContext('2d');

        // Neutral normal (pointing up)
        normalCtx.fillStyle = '#8080ff';
        normalCtx.fillRect(0, 0, texSize, texSize);

        // Add grass blade normal variations
        for (let i = 0; i < 6000; i++) {
            const x = Math.random() * texSize;
            const y = Math.random() * texSize;
            const length = 4 + Math.random() * 10;
            const angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.5;

            // Slight normal tilt (blueish with slight red/green offset)
            const tilt = Math.random() * 40;
            const r = 128 + Math.cos(angle) * tilt;
            const g = 128 + Math.sin(angle) * tilt;
            normalCtx.strokeStyle = `rgb(${r}, ${g}, 255)`;
            normalCtx.lineWidth = 1 + Math.random();

            normalCtx.beginPath();
            normalCtx.moveTo(x, y);
            normalCtx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
            normalCtx.stroke();
        }

        const normalTexture = new THREE.CanvasTexture(normalCanvas);
        normalTexture.wrapS = THREE.RepeatWrapping;
        normalTexture.wrapT = THREE.RepeatWrapping;
        normalTexture.repeat.set(12, 10);

        // === ROUGHNESS MAP ===
        const roughCanvas = document.createElement('canvas');
        roughCanvas.width = 256;
        roughCanvas.height = 256;
        const roughCtx = roughCanvas.getContext('2d');

        // High roughness base (grass is not shiny)
        roughCtx.fillStyle = '#e0e0e0';
        roughCtx.fillRect(0, 0, 256, 256);

        // Slight variations
        for (let i = 0; i < 500; i++) {
            const x = Math.random() * 256;
            const y = Math.random() * 256;
            const val = 200 + Math.floor(Math.random() * 55);
            roughCtx.fillStyle = `rgb(${val}, ${val}, ${val})`;
            roughCtx.fillRect(x, y, 2 + Math.random() * 4, 6 + Math.random() * 10);
        }

        const roughnessTexture = new THREE.CanvasTexture(roughCanvas);
        roughnessTexture.wrapS = THREE.RepeatWrapping;
        roughnessTexture.wrapT = THREE.RepeatWrapping;
        roughnessTexture.repeat.set(12, 10);

        // PBR Material with grass textures
        const material = new THREE.MeshStandardMaterial({
            map: colorTexture,
            normalMap: normalTexture,
            normalScale: new THREE.Vector2(0.5, 0.5),
            roughnessMap: roughnessTexture,
            roughness: 0.95,
            metalness: 0.0,
        });

        const ground = new THREE.Mesh(geometry, material);
        ground.rotation.x = -Math.PI / 2;
        ground.position.z = 0; // Centered for compact field
        this.scene.add(ground);
    }

    createGrass() {
        const instances = this.qualityPreset.grassInstances;
        const fieldWidth = 120; // Compact width for density
        const fieldDepth = 100; // Compact depth
        const bladeSegments = 24; // Ultra high resolution curvature
        const bladeWidth = 0.08; // Thicker blades for better visibility
        const bladeHeightBase = 1.0;

        // Create single blade geometry
        const bladeGeometry = new THREE.PlaneGeometry(bladeWidth, bladeHeightBase, 1, bladeSegments);
        bladeGeometry.translate(0, bladeHeightBase / 2, 0);

        // Create instanced geometry
        const instancedGeometry = new THREE.InstancedBufferGeometry();
        instancedGeometry.index = bladeGeometry.index;
        instancedGeometry.attributes.position = bladeGeometry.attributes.position;
        instancedGeometry.attributes.uv = bladeGeometry.attributes.uv;
        instancedGeometry.attributes.normal = bladeGeometry.attributes.normal;

        // Per-instance attributes
        const offsets = new Float32Array(instances * 3);
        const heights = new Float32Array(instances);
        const phases = new Float32Array(instances);
        const indices = new Float32Array(instances);

        for (let i = 0; i < instances; i++) {
            // Random position in compact field close to camera
            const x = (Math.random() - 0.5) * fieldWidth;
            const z = (Math.random() - 0.5) * fieldDepth; // Centered around z=0

            // Hill curve - higher in center, lower at edges
            const distFromCenter = Math.sqrt(x * x + (z + 20) * (z + 20));
            const hillHeight = Math.cos(distFromCenter * 0.012) * 5 - 3;

            offsets[i * 3] = x;
            offsets[i * 3 + 1] = hillHeight;
            offsets[i * 3 + 2] = z;

            // Random height - smaller blades
            heights[i] = 0.6 + Math.random() * 1.0;

            // Random phase for wind
            phases[i] = Math.random() * Math.PI * 2;

            // Index for color variation
            indices[i] = Math.random();
        }

        instancedGeometry.setAttribute('offset', new THREE.InstancedBufferAttribute(offsets, 3));
        instancedGeometry.setAttribute('bladeHeight', new THREE.InstancedBufferAttribute(heights, 1));
        instancedGeometry.setAttribute('bladePhase', new THREE.InstancedBufferAttribute(phases, 1));
        instancedGeometry.setAttribute('bladeIndex', new THREE.InstancedBufferAttribute(indices, 1));

        // Material
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uWindStrength: { value: 1.0 },
                uSunDirection: { value: this.sunDirection },
            },
            vertexShader: GrassShader.vertexShader,
            fragmentShader: GrassShader.fragmentShader,
            side: THREE.DoubleSide,
        });

        this.grass = new THREE.Mesh(instancedGeometry, material);
        this.grass.frustumCulled = false;
        this.scene.add(this.grass);

        console.log(`[SummerTheme] Created ${instances} grass blades`);
    }

    createButterflies() {
        const count = this.qualityPreset.butterflyCount;
        const colors = [0xFF6B35, 0x87CEEB, 0xFFD700, 0xFF69B4, 0xFF4500, 0x9370DB, 0x00CED1, 0xFFB6C1];

        for (let i = 0; i < count; i++) {
            const butterfly = this.createSingleButterfly(colors[i % colors.length]);

            // Spread across the entire visible field above the grass
            butterfly.position.set(
                (Math.random() - 0.5) * 100, // Wide X spread
                3 + Math.random() * 20, // Y: 3 to 23 units above ground
                (Math.random() - 0.5) * 80 - 10, // Z: across the grass field
            );

            butterfly.userData = {
                startPos: butterfly.position.clone(),
                phase: Math.random() * Math.PI * 2,
                speed: 0.2 + Math.random() * 0.4,
                amplitude: 25 + Math.random() * 30, // Larger flight paths
                verticalAmp: 3 + Math.random() * 5, // Vertical bobbing
                wingPhase: Math.random() * Math.PI * 2,
                orbitRadius: 20 + Math.random() * 40, // Orbit size
                orbitSpeed: 0.1 + Math.random() * 0.2, // Orbit speed
            };
            this.butterflies.push(butterfly);
            this.scene.add(butterfly);
        }
    }

    createSingleButterfly(baseColor) {
        const group = new THREE.Group();

        // Convert hex color to RGB for manipulation
        const color = new THREE.Color(baseColor);
        const hsl = {};
        color.getHSL(hsl);

        // Create wing texture with patterns
        const createWingTexture = (isUpper) => {
            const canvas = document.createElement('canvas');
            canvas.width = 128;
            canvas.height = 128;
            const ctx = canvas.getContext('2d');

            // Base gradient
            const gradient = ctx.createRadialGradient(20, 64, 0, 80, 64, 80);
            const baseColorStr = `hsl(${hsl.h * 360}, ${hsl.s * 100}%, ${hsl.l * 100}%)`;
            const lightColorStr = `hsl(${hsl.h * 360}, ${hsl.s * 100}%, ${Math.min(90, hsl.l * 100 + 30)}%)`;
            const darkColorStr = `hsl(${hsl.h * 360}, ${hsl.s * 100}%, ${hsl.l * 50}%)`;

            gradient.addColorStop(0, lightColorStr);
            gradient.addColorStop(0.5, baseColorStr);
            gradient.addColorStop(1, darkColorStr);
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 128, 128);

            // Wing veins
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
            ctx.lineWidth = 1;
            for (let i = 0; i < 6; i++) {
                ctx.beginPath();
                ctx.moveTo(10, 64);
                const angle = (i - 2.5) * 0.25;
                ctx.quadraticCurveTo(60, 64 + angle * 60, 120, 64 + angle * 100);
                ctx.stroke();
            }

            // Spots/patterns
            const spotCount = isUpper ? 4 : 2;
            for (let i = 0; i < spotCount; i++) {
                const x = 40 + Math.random() * 60;
                const y = 30 + Math.random() * 70;
                const radius = 8 + Math.random() * 12;

                // Outer ring
                ctx.beginPath();
                ctx.arc(x, y, radius, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
                ctx.fill();

                // Inner spot
                ctx.beginPath();
                ctx.arc(x, y, radius * 0.6, 0, Math.PI * 2);
                ctx.fillStyle = `hsla(${(hsl.h * 360 + 180) % 360}, 80%, 70%, 0.8)`;
                ctx.fill();

                // Highlight
                ctx.beginPath();
                ctx.arc(x - 2, y - 2, radius * 0.25, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
                ctx.fill();
            }

            // Edge detail
            ctx.strokeStyle = darkColorStr;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(64, 64, 60, 0, Math.PI * 2);
            ctx.stroke();

            // Iridescent shimmer
            const shimmer = ctx.createLinearGradient(0, 0, 128, 128);
            shimmer.addColorStop(0, 'rgba(255, 255, 255, 0.1)');
            shimmer.addColorStop(0.5, 'rgba(255, 255, 255, 0.3)');
            shimmer.addColorStop(1, 'rgba(255, 255, 255, 0.05)');
            ctx.fillStyle = shimmer;
            ctx.fillRect(0, 0, 128, 128);

            return new THREE.CanvasTexture(canvas);
        };

        // Custom butterfly wing shape
        const createWingShape = (isUpper) => {
            const shape = new THREE.Shape();
            if (isUpper) {
                // Upper wing - larger, more rounded
                shape.moveTo(0, 0);
                shape.bezierCurveTo(0.3, 0.6, 0.8, 0.9, 1.2, 0.7);
                shape.bezierCurveTo(1.4, 0.5, 1.3, 0.1, 1.1, -0.2);
                shape.bezierCurveTo(0.8, -0.4, 0.4, -0.2, 0, 0);
            } else {
                // Lower wing - smaller, more pointed
                shape.moveTo(0, 0);
                shape.bezierCurveTo(0.2, -0.3, 0.6, -0.6, 0.9, -0.5);
                shape.bezierCurveTo(1.1, -0.3, 1.0, 0.1, 0.7, 0.2);
                shape.bezierCurveTo(0.4, 0.2, 0.1, 0.1, 0, 0);
            }
            return shape;
        };

        // Create wing materials
        const upperTexture = createWingTexture(true);
        const lowerTexture = createWingTexture(false);

        const wingMaterial = (texture) => new THREE.MeshStandardMaterial({
            map: texture,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.92,
            roughness: 0.3,
            metalness: 0.1,
            emissive: color,
            emissiveIntensity: 0.1,
        });

        // Upper wings
        const upperWingGeo = new THREE.ShapeGeometry(createWingShape(true));

        const leftUpperWing = new THREE.Mesh(upperWingGeo, wingMaterial(upperTexture));
        leftUpperWing.position.set(0.05, 0.1, 0);
        leftUpperWing.rotation.y = -0.2;
        leftUpperWing.name = 'leftUpper';
        group.add(leftUpperWing);

        const rightUpperWing = new THREE.Mesh(upperWingGeo, wingMaterial(upperTexture.clone()));
        rightUpperWing.position.set(-0.05, 0.1, 0);
        rightUpperWing.scale.x = -1;
        rightUpperWing.rotation.y = 0.2;
        rightUpperWing.name = 'rightUpper';
        group.add(rightUpperWing);

        // Lower wings
        const lowerWingGeo = new THREE.ShapeGeometry(createWingShape(false));

        const leftLowerWing = new THREE.Mesh(lowerWingGeo, wingMaterial(lowerTexture));
        leftLowerWing.position.set(0.05, -0.1, 0);
        leftLowerWing.rotation.y = -0.15;
        leftLowerWing.name = 'leftLower';
        group.add(leftLowerWing);

        const rightLowerWing = new THREE.Mesh(lowerWingGeo, wingMaterial(lowerTexture.clone()));
        rightLowerWing.position.set(-0.05, -0.1, 0);
        rightLowerWing.scale.x = -1;
        rightLowerWing.rotation.y = 0.15;
        rightLowerWing.name = 'rightLower';
        group.add(rightLowerWing);

        // Fuzzy body
        const bodyColor = new THREE.Color(0x2a1810);
        const bodyMaterial = new THREE.MeshStandardMaterial({
            color: bodyColor,
            roughness: 1.0,
            metalness: 0,
        });

        // Thorax
        const thoraxGeo = new THREE.SphereGeometry(0.12, 12, 8);
        thoraxGeo.scale(1, 1.5, 1);
        const thorax = new THREE.Mesh(thoraxGeo, bodyMaterial);
        thorax.position.set(0, 0, 0);
        group.add(thorax);

        // Abdomen
        const abdomenGeo = new THREE.SphereGeometry(0.1, 12, 8);
        abdomenGeo.scale(1, 2.5, 1);
        const abdomen = new THREE.Mesh(abdomenGeo, bodyMaterial);
        abdomen.position.set(0, -0.35, 0);
        group.add(abdomen);

        // Head
        const headGeo = new THREE.SphereGeometry(0.08, 12, 8);
        const head = new THREE.Mesh(headGeo, bodyMaterial);
        head.position.set(0, 0.25, 0);
        group.add(head);

        // Eyes
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
        const eyeGeo = new THREE.SphereGeometry(0.025, 8, 8);
        const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
        leftEye.position.set(0.05, 0.27, 0.05);
        group.add(leftEye);
        const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
        rightEye.position.set(-0.05, 0.27, 0.05);
        group.add(rightEye);

        // Antennae
        const antennaMat = new THREE.MeshBasicMaterial({ color: 0x1a0a05 });
        const antennaCurve1 = new THREE.CatmullRomCurve3([
            new THREE.Vector3(0.03, 0.3, 0),
            new THREE.Vector3(0.08, 0.45, 0.02),
            new THREE.Vector3(0.12, 0.55, 0.05),
        ]);
        const antennaCurve2 = new THREE.CatmullRomCurve3([
            new THREE.Vector3(-0.03, 0.3, 0),
            new THREE.Vector3(-0.08, 0.45, 0.02),
            new THREE.Vector3(-0.12, 0.55, 0.05),
        ]);
        const antennaGeo1 = new THREE.TubeGeometry(antennaCurve1, 8, 0.008, 6, false);
        const antennaGeo2 = new THREE.TubeGeometry(antennaCurve2, 8, 0.008, 6, false);
        group.add(new THREE.Mesh(antennaGeo1, antennaMat));
        group.add(new THREE.Mesh(antennaGeo2, antennaMat));

        // Antenna tips
        const tipGeo = new THREE.SphereGeometry(0.015, 6, 6);
        const tip1 = new THREE.Mesh(tipGeo, antennaMat);
        tip1.position.set(0.12, 0.55, 0.05);
        group.add(tip1);
        const tip2 = new THREE.Mesh(tipGeo, antennaMat);
        tip2.position.set(-0.12, 0.55, 0.05);
        group.add(tip2);

        group.scale.set(1.2, 1.2, 1.2);
        return group;
    }

    createPollen() {
        const count = this.qualityPreset.pollenCount;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);

        for (let i = 0; i < count; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 80;
            positions[i * 3 + 1] = 1 + Math.random() * 20;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 80;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = new THREE.PointsMaterial({
            size: 0.15,
            color: 0xFFFFCC,
            transparent: true,
            opacity: 0.6,
            sizeAttenuation: true,
        });

        this.pollen = new THREE.Points(geometry, material);
        this.scene.add(this.pollen);
    }

    createBumblebees() {
        const count = this.qualityPreset.bumblebeeCount;

        for (let i = 0; i < count; i++) {
            const bumblebee = this.createSingleBumblebee();

            // Spawn close to grass level
            bumblebee.position.set(
                (Math.random() - 0.5) * 80,
                1 + Math.random() * 4, // Low, near grass
                (Math.random() - 0.5) * 60,
            );

            bumblebee.userData = {
                startPos: bumblebee.position.clone(),
                phase: Math.random() * Math.PI * 2,
                speed: 0.4 + Math.random() * 0.3,
                wingPhase: Math.random() * Math.PI * 2,
                state: 'flying', // 'flying' or 'sitting'
                stateTimer: 0,
                flyDuration: 3 + Math.random() * 5,
                sitDuration: 1 + Math.random() * 3,
                targetY: 1 + Math.random() * 3,
                hoverHeight: 1.5 + Math.random() * 2,
            };
            this.bumblebees.push(bumblebee);
            this.scene.add(bumblebee);
        }
    }

    createSingleBumblebee() {
        const group = new THREE.Group();

        // === FUZZY BODY ===
        // Create stripe texture for body - BRIGHT CLEAR YELLOW
        const stripeCanvas = document.createElement('canvas');
        stripeCanvas.width = 128;
        stripeCanvas.height = 128;
        const stripeCtx = stripeCanvas.getContext('2d');

        // Bright yellow and black stripes
        const stripeHeight = 128 / 5;
        for (let i = 0; i < 5; i++) {
            if (i % 2 === 0) {
                // Black stripes
                stripeCtx.fillStyle = '#0a0a0a';
            } else {
                // Super bright vibrant yellow
                const gradient = stripeCtx.createLinearGradient(0, i * stripeHeight, 128, (i + 1) * stripeHeight);
                gradient.addColorStop(0, '#FFFF40'); // Bright lemon yellow
                gradient.addColorStop(0.5, '#FFFF00'); // Pure yellow (max saturation)
                gradient.addColorStop(1, '#FFFF40');
                stripeCtx.fillStyle = gradient;
            }
            stripeCtx.fillRect(0, i * stripeHeight, 128, stripeHeight);
        }

        // Subtle fuzzy edge (less noise for cleaner look)
        for (let i = 0; i < 150; i++) {
            const x = Math.random() * 128;
            const y = Math.random() * 128;
            const inYellow = Math.floor(y / stripeHeight) % 2 === 1;
            if (inYellow) {
                stripeCtx.fillStyle = 'rgba(255, 240, 100, 0.4)';
            } else {
                stripeCtx.fillStyle = 'rgba(40, 40, 40, 0.3)';
            }
            stripeCtx.fillRect(x, y, 1.5, 1.5);
        }

        const stripeTexture = new THREE.CanvasTexture(stripeCanvas);

        const bodyMaterial = new THREE.MeshStandardMaterial({
            map: stripeTexture,
            roughness: 0.7,
            metalness: 0.1,
            emissive: new THREE.Color(0x554400),
            emissiveIntensity: 0.25,
        });

        // Thorax (front body)
        const thoraxGeo = new THREE.SphereGeometry(0.15, 16, 12);
        thoraxGeo.scale(1, 0.9, 1.2);
        const thorax = new THREE.Mesh(thoraxGeo, bodyMaterial);
        thorax.position.set(0, 0, 0.1);
        group.add(thorax);

        // Abdomen (rear body - larger, striped)
        const abdomenGeo = new THREE.SphereGeometry(0.18, 16, 12);
        abdomenGeo.scale(1, 0.85, 1.5);
        const abdomen = new THREE.Mesh(abdomenGeo, bodyMaterial);
        abdomen.position.set(0, 0, -0.2);
        group.add(abdomen);

        // === HEAD ===
        const headMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 });
        const headGeo = new THREE.SphereGeometry(0.1, 12, 10);
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.set(0, 0, 0.25);
        group.add(head);

        // Compound eyes
        const eyeMat = new THREE.MeshStandardMaterial({
            color: 0x2a2a2a,
            roughness: 0.2,
            metalness: 0.3,
        });
        const eyeGeo = new THREE.SphereGeometry(0.04, 8, 8);
        const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
        leftEye.position.set(0.06, 0.02, 0.3);
        group.add(leftEye);
        const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
        rightEye.position.set(-0.06, 0.02, 0.3);
        group.add(rightEye);

        // Antennae
        const antennaMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
        const antennaCurve1 = new THREE.CatmullRomCurve3([
            new THREE.Vector3(0.03, 0.05, 0.28),
            new THREE.Vector3(0.05, 0.12, 0.32),
            new THREE.Vector3(0.04, 0.15, 0.35),
        ]);
        const antennaCurve2 = new THREE.CatmullRomCurve3([
            new THREE.Vector3(-0.03, 0.05, 0.28),
            new THREE.Vector3(-0.05, 0.12, 0.32),
            new THREE.Vector3(-0.04, 0.15, 0.35),
        ]);
        const antennaGeo1 = new THREE.TubeGeometry(antennaCurve1, 6, 0.008, 4, false);
        const antennaGeo2 = new THREE.TubeGeometry(antennaCurve2, 6, 0.008, 4, false);
        group.add(new THREE.Mesh(antennaGeo1, antennaMat));
        group.add(new THREE.Mesh(antennaGeo2, antennaMat));

        // === WINGS ===
        const wingShape = new THREE.Shape();
        wingShape.moveTo(0, 0);
        wingShape.bezierCurveTo(0.15, 0.1, 0.25, 0.15, 0.3, 0.05);
        wingShape.bezierCurveTo(0.32, -0.02, 0.25, -0.08, 0.15, -0.05);
        wingShape.bezierCurveTo(0.08, -0.02, 0.02, 0, 0, 0);

        const wingMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.35,
            side: THREE.DoubleSide,
            roughness: 0.1,
            metalness: 0.2,
        });

        const wingGeo = new THREE.ShapeGeometry(wingShape);

        // Left wings
        const leftWing1 = new THREE.Mesh(wingGeo, wingMat);
        leftWing1.position.set(0.08, 0.1, 0.05);
        leftWing1.rotation.x = -0.3;
        leftWing1.rotation.z = 0.5;
        leftWing1.name = 'leftWing';
        group.add(leftWing1);

        // Right wings
        const rightWing1 = new THREE.Mesh(wingGeo, wingMat.clone());
        rightWing1.position.set(-0.08, 0.1, 0.05);
        rightWing1.rotation.x = -0.3;
        rightWing1.rotation.z = -0.5;
        rightWing1.scale.x = -1;
        rightWing1.name = 'rightWing';
        group.add(rightWing1);

        // === LEGS (6 tiny legs) ===
        const legMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
        const legPositions = [
            { x: 0.08, z: 0.12 }, { x: 0.1, z: 0 }, { x: 0.08, z: -0.12 },
            { x: -0.08, z: 0.12 }, { x: -0.1, z: 0 }, { x: -0.08, z: -0.12 },
        ];

        legPositions.forEach((pos, i) => {
            const legCurve = new THREE.CatmullRomCurve3([
                new THREE.Vector3(pos.x * 0.5, -0.05, pos.z),
                new THREE.Vector3(pos.x, -0.12, pos.z),
                new THREE.Vector3(pos.x * 1.1, -0.18, pos.z),
            ]);
            const legGeo = new THREE.TubeGeometry(legCurve, 4, 0.012, 4, false);
            group.add(new THREE.Mesh(legGeo, legMat));
        });

        // Stinger
        const stingerGeo = new THREE.ConeGeometry(0.02, 0.08, 6);
        const stingerMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
        const stinger = new THREE.Mesh(stingerGeo, stingerMat);
        stinger.position.set(0, 0, -0.42);
        stinger.rotation.x = Math.PI / 2;
        group.add(stinger);

        group.scale.set(0.9, 0.9, 0.9); // Smaller, cuter size
        return group;
    }

    setupPostProcessing() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        const pixelRatio = this.renderer.getPixelRatio();

        // Use MSAA render target for smooth edges
        // IMPORTANT: Size must be multiplied by pixelRatio for sharp rendering on high DPI screens
        const renderTarget = new THREE.WebGLRenderTarget(w * pixelRatio, h * pixelRatio, {
            samples: 8,
            type: THREE.HalfFloatType,
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            stencilBuffer: false,
            depthBuffer: true,
        });

        this.composer = new EffectComposer(this.renderer, renderTarget);
        this.composer.setPixelRatio(pixelRatio);
        this.composer.setSize(w, h); // This will update internal buffers to w*pixelRatio, h*pixelRatio

        this.composer.addPass(new RenderPass(this.scene, this.camera));

        // Bloom pass with correct physical resolution
        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(w * pixelRatio, h * pixelRatio),
            this.qualityPreset.bloomStrength,
            0.4,
            0.85,
        );
        this.composer.addPass(this.bloomPass);
    }

    setupEventListeners() {
        this.eventUnsubscribers.push(
            eventBus.on(EVENTS.PIECE_LOCKED, () => {
                this.targetPulse = Math.min(this.targetPulse + 0.3, 1.0);
            }),
            eventBus.on(EVENTS.COMBO, ({ comboCount }) => {
                this.targetPulse = Math.min(comboCount * 0.15, 1.5);
                this.targetWind = 1.0 + comboCount * 0.4;
            }),
            eventBus.on(EVENTS.LINE_CLEAR, ({ lineCount }) => {
                this.targetPulse = Math.min(lineCount * 0.2, 1.0);
                this.targetWind = 1.0 + lineCount * 0.3;
            }),
        );

        window.addEventListener('resize', this.handleResize.bind(this));
    }

    handleResize() {
        const w = window.innerWidth;
        const h = window.innerHeight;

        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();

        this.renderer.setSize(w, h);
        this.composer?.setSize(w, h);
    }

    startAnimationLoop() {
        const animate = () => {
            if (!this.isActive) {
                this.animationFrameId = null;
                return;
            }
            this.animationFrameId = requestAnimationFrame(animate);
            this.update();
        };
        animate();
    }

    update() {
        const delta = this.clock.getDelta();
        this.time += delta;

        // Smooth transitions
        this.pulseIntensity += (this.targetPulse - this.pulseIntensity) * 0.05;
        this.targetPulse *= 0.98;
        this.windStrength += (this.targetWind - this.windStrength) * 0.02;
        this.targetWind = Math.max(1.0, this.targetWind * 0.995);

        // Update sun
        if (this.sun?.material?.uniforms) {
            this.sun.material.uniforms.uTime.value = this.time;
            this.sun.material.uniforms.uPulse.value = this.pulseIntensity;
        }

        // Update grass
        if (this.grass?.material?.uniforms) {
            this.grass.material.uniforms.uTime.value = this.time;
            this.grass.material.uniforms.uWindStrength.value = this.windStrength;
        }

        // Update butterflies - free-roaming flight paths
        this.butterflies.forEach((butterfly) => {
            const data = butterfly.userData;
            if (!data) return;

            const t = this.time * data.speed + data.phase;

            // Figure-8 / lemniscate flight pattern for natural movement
            const orbitT = this.time * data.orbitSpeed + data.phase;
            const figure8X = Math.sin(orbitT) * data.orbitRadius;
            const figure8Z = Math.sin(orbitT * 2) * data.orbitRadius * 0.4;

            // Combine base position with orbit and additional wandering
            butterfly.position.x = data.startPos.x + figure8X + Math.sin(t * 0.3) * 8;
            butterfly.position.y = data.startPos.y + Math.sin(t * 0.5) * data.verticalAmp + Math.sin(t * 1.2) * 2;
            butterfly.position.z = data.startPos.z + figure8Z + Math.cos(t * 0.4) * 10;

            // Keep butterflies in bounds
            if (butterfly.position.y < 2) butterfly.position.y = 2;
            if (butterfly.position.y > 25) butterfly.position.y = 25;

            // Wing flapping - find wings by name
            data.wingPhase += delta * 15;
            const upperAngle = Math.sin(data.wingPhase) * 0.7;
            const lowerAngle = Math.sin(data.wingPhase + 0.3) * 0.5; // Slightly offset

            butterfly.traverse((child) => {
                if (child.name === 'leftUpper') child.rotation.y = -0.2 - upperAngle;
                if (child.name === 'rightUpper') child.rotation.y = 0.2 + upperAngle;
                if (child.name === 'leftLower') child.rotation.y = -0.15 - lowerAngle;
                if (child.name === 'rightLower') child.rotation.y = 0.15 + lowerAngle;
            });

            // Face movement direction (velocity-based)
            const velX = Math.cos(orbitT) * data.orbitRadius * data.orbitSpeed + Math.cos(t * 0.3) * 2.4;
            const velZ = Math.cos(orbitT * 2) * data.orbitRadius * 0.8 * data.orbitSpeed - Math.sin(t * 0.4) * 4;
            butterfly.lookAt(
                butterfly.position.x + velX,
                butterfly.position.y,
                butterfly.position.z + velZ,
            );
        });

        // Update bumblebees - low flying with landing behavior
        this.bumblebees.forEach((bee) => {
            const data = bee.userData;
            if (!data) return;

            data.stateTimer += delta;
            const t = this.time * data.speed + data.phase;

            if (data.state === 'flying') {
                // Erratic buzzing flight pattern close to grass
                const buzzX = Math.sin(t * 3) * 0.5 + Math.sin(t * 0.5) * 8;
                const buzzZ = Math.cos(t * 2.5) * 0.4 + Math.cos(t * 0.4) * 6;
                const buzzY = Math.sin(t * 4) * 0.3 + Math.sin(t * 0.8) * 1.5;

                bee.position.x = data.startPos.x + buzzX;
                bee.position.z = data.startPos.z + buzzZ;
                bee.position.y = data.hoverHeight + buzzY;

                // Keep low over grass
                if (bee.position.y < 0.8) bee.position.y = 0.8;
                if (bee.position.y > 6) bee.position.y = 6;

                // Rapid wing buzzing
                data.wingPhase += delta * 80;
                const wingBuzz = Math.sin(data.wingPhase) * 0.4;
                bee.traverse((child) => {
                    if (child.name === 'leftWing') child.rotation.z = 0.5 + wingBuzz;
                    if (child.name === 'rightWing') child.rotation.z = -0.5 - wingBuzz;
                });

                // Face movement direction
                bee.lookAt(
                    bee.position.x + Math.cos(t * 3) * 2,
                    bee.position.y,
                    bee.position.z - Math.sin(t * 2.5) * 2,
                );

                // Transition to sitting
                if (data.stateTimer > data.flyDuration) {
                    data.state = 'descending';
                    data.stateTimer = 0;
                    data.targetY = 0.3 + Math.random() * 0.3; // Land height
                }
            } else if (data.state === 'descending') {
                // Descend to grass
                bee.position.y = THREE.MathUtils.lerp(bee.position.y, data.targetY, delta * 2);

                // Slow wing movement during descent
                data.wingPhase += delta * 40;
                const wingBuzz = Math.sin(data.wingPhase) * 0.3;
                bee.traverse((child) => {
                    if (child.name === 'leftWing') child.rotation.z = 0.3 + wingBuzz;
                    if (child.name === 'rightWing') child.rotation.z = -0.3 - wingBuzz;
                });

                if (Math.abs(bee.position.y - data.targetY) < 0.1) {
                    data.state = 'sitting';
                    data.stateTimer = 0;
                }
            } else if (data.state === 'sitting') {
                // Sitting on grass - wings folded
                bee.traverse((child) => {
                    if (child.name === 'leftWing') child.rotation.z = 0.1;
                    if (child.name === 'rightWing') child.rotation.z = -0.1;
                });

                // Subtle body movement while sitting
                bee.rotation.z = Math.sin(this.time * 2 + data.phase) * 0.05;

                // Transition back to flying
                if (data.stateTimer > data.sitDuration) {
                    data.state = 'ascending';
                    data.stateTimer = 0;
                    data.hoverHeight = 1.5 + Math.random() * 2;
                    // Move start position for next flight path
                    data.startPos.x += (Math.random() - 0.5) * 15;
                    data.startPos.z += (Math.random() - 0.5) * 15;
                    // Keep in bounds
                    data.startPos.x = THREE.MathUtils.clamp(data.startPos.x, -40, 40);
                    data.startPos.z = THREE.MathUtils.clamp(data.startPos.z, -30, 30);
                }
            } else if (data.state === 'ascending') {
                // Take off
                bee.position.y = THREE.MathUtils.lerp(bee.position.y, data.hoverHeight, delta * 3);

                // Wings speed up
                data.wingPhase += delta * 60;
                const wingBuzz = Math.sin(data.wingPhase) * 0.35;
                bee.traverse((child) => {
                    if (child.name === 'leftWing') child.rotation.z = 0.4 + wingBuzz;
                    if (child.name === 'rightWing') child.rotation.z = -0.4 - wingBuzz;
                });

                if (Math.abs(bee.position.y - data.hoverHeight) < 0.2) {
                    data.state = 'flying';
                    data.stateTimer = 0;
                    data.flyDuration = 3 + Math.random() * 5;
                }
            }
        });

        // Update pollen
        if (this.pollen) {
            const positions = this.pollen.geometry.attributes.position.array;
            for (let i = 0; i < positions.length; i += 3) {
                positions[i] += Math.sin(this.time + i) * 0.005 * this.windStrength;
                positions[i + 1] += 0.01;
                positions[i + 2] += Math.cos(this.time + i) * 0.005 * this.windStrength;

                if (positions[i + 1] > 25) {
                    positions[i + 1] = 1;
                    positions[i] = (Math.random() - 0.5) * 80;
                    positions[i + 2] = (Math.random() - 0.5) * 80;
                }
            }
            this.pollen.geometry.attributes.position.needsUpdate = true;
        }

        // Render
        if (this.composer) {
            this.composer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Lifecycle
    // ─────────────────────────────────────────────────────────────────────────

    async start() {
        console.log('[SummerTheme] Starting...');
        await super.start();
        await this.createScene();
    }

    async resume() {
        console.log('[SummerTheme] Resuming...');
        await super.resume();
        if (this.animationFrameId === null && this.renderer) {
            this.startAnimationLoop();
        }
    }

    async stop() {
        console.log('[SummerTheme] Stopping...');
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        await super.stop();
    }

    cleanup() {
        console.log('[SummerTheme] Cleaning up...');

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];

        if (this.renderer) {
            this.renderer.dispose();
            this.renderer = null;
        }

        if (this.composer) {
            this.composer.dispose();
            this.composer = null;
        }

        this.sun = null;
        this.grass = null;
        this.pollen = null;
        this.butterflies = [];
        this.sunGlowLayers = [];

        super.cleanup();
    }
}
