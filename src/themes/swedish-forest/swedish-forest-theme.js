/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  🌲 SWEDISH FOREST THEME - Three.js 3D Implementation 🌲
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * A mystical Nordic forest with layered triangular spruce trees, fireflies,
 * god rays, forest spirits, aurora borealis, stars, and atmospheric mist.
 * Inspired by Swedish forest landscapes with deep blue-green atmosphere.
 */

import * as THREE from 'three';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { SWEDISH_FOREST_TETROMINOS } from './swedish-forest-tetrominos.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

// Import mossy ground PBR texture URLs
import forestFloorAlbedoUrl from './assets/mossy-ground1-albedo.png';
import forestFloorNormalUrl from './assets/mossy-groundnormal.png';
import forestFloorRoughnessUrl from './assets/mossy-ground1-roughness.png';
import forestFloorHeightUrl from './assets/mossy-ground1-height.png';
import forestFloorAoUrl from './assets/mossy-ground1-ao.png';
import {
    groundVertexShader,
    groundFragmentShader,
    mistVertexShader,
    mistFragmentShader,
    godRayVertexShader,
    godRayFragmentShader,
    fireflyVertexShader,
    fireflyFragmentShader,
    starVertexShader,
    starFragmentShader,
    spiritVertexShader,
    spiritFragmentShader,
    auroraVertexShader,
    auroraFragmentShader,
    spiritWindVertexShader,
    spiritWindFragmentShader,
    leafVertexShader,
    leafFragmentShader,
    instancedFoliageVertexShader,
    instancedFoliageFragmentShader,
    instancedTrunkVertexShader,
    instancedTrunkFragmentShader,
} from './swedish-forest-shaders.js';

// ═══════════════════════════════════════════════════════════════════════════
// THEME CONSTANTS - Nordic forest color palette
// ═══════════════════════════════════════════════════════════════════════════

const COLORS = {
    // Background gradient - darker at top, lighter at horizon
    skyTop: new THREE.Color(0x020508),     // Very dark blue-black
    skyMid: new THREE.Color(0x051015),     // Dark blue-green
    skyHorizon: new THREE.Color(0x1A3040), // Lighter teal at horizon

    // Tree layers (front to back) - more contrast
    treeLayers: [
        new THREE.Color(0x0A1518), // Front - very dark
        new THREE.Color(0x0F1F26), // Mid-front
        new THREE.Color(0x162A33), // Mid-back
        new THREE.Color(0x1C3642), // Back
    ],

    // Trunk colors
    trunkLayers: [
        new THREE.Color(0x050A0C),
        new THREE.Color(0x0A1518),
        new THREE.Color(0x101D22),
        new THREE.Color(0x152830),
    ],

    // Ground floor colors
    groundBase: new THREE.Color(0x1A2520),  // Dark forest floor
    groundMoss: new THREE.Color(0x2A3A30),  // Moss green
    groundDirt: new THREE.Color(0x151A18),  // Dark dirt

    // Effects
    mist: new THREE.Color(0xA0B8C0),    // Cooler mist
    godRay: new THREE.Color(0xB0E0C8),  // Soft green-white
    firefly: new THREE.Color(0xCCFFAA), // Yellow-green

    // Spirit colors - more ethereal
    spiritBase: new THREE.Color(0x70E0C0), // Bright cyan-green
    spiritGlow: new THREE.Color(0xB0FFF0),

    // Aurora colors
    aurora1: new THREE.Color(0x32FF96), // Green
    aurora2: new THREE.Color(0x32C8FF), // Cyan
    aurora3: new THREE.Color(0x9632FF), // Purple

    // Spirit wind
    windColor: new THREE.Color(0x70E0B0),

    // Fog
    fog: new THREE.Color(0x0A1820),
};

export default class SwedishForestTheme extends BaseTheme {
    constructor() {
        super('swedish-forest');

        // Event handling
        this.eventUnsubscribers = [];

        // Resolution handling
        this.targetResolution = null;
        this.resolutionMode = 'auto';

        // Three.js components
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.mainGroup = null;
        this.clock = new THREE.Clock();
        this.animationFrame = null;

        // Scene elements
        this.foliageInstancedMesh = null;  // Single InstancedMesh for all tree foliage
        this.trunkInstancedMesh = null;    // Single InstancedMesh for all tree trunks
        this.groundPlane = null;
        this.starfield = null;
        this.mistPlanes = [];
        this.godRays = [];
        this.fireflySystem = null;
        this.spirits = [];
        this.auroraPlanes = [];
        this.spiritWinds = [];
        this.fallingLeaves = null;

        // New features - grass and mushrooms
        this.grassMesh = null;
        this.grassMaterial = null;
        this.mushrooms = [];
        this.mushroomLights = [];
        this.mushroomPulse = 0;

        // Shared uniforms
        this.uniforms = {
            time: { value: 0 },
            glowIntensity: { value: 0 },
            mistIntensity: { value: 0.6 },
            auroraIntensity: { value: 0 },
            windSpeed: { value: 0 },
        };

        // Effect targets for smooth transitions
        this.targetGlowIntensity = 0;
        this.targetMistIntensity = 0.6;
        this.targetAuroraIntensity = 0;
        this.targetWindSpeed = 0;
        this.comboMultiplier = 1.0;
    }

    getTetrominoConfig() {
        return SWEDISH_FOREST_TETROMINOS;
    }

    async createScene() {
        console.log('[SwedishForest] Initializing Three.js scene...');

        const container = document.getElementById('swedish-forest-theme');
        if (!container) {
            console.error('[SwedishForest] Container not found');
            return;
        }

        container.innerHTML = '';

        // ─────────────────────────────────────────────────────────────────────
        // SCENE SETUP
        // ─────────────────────────────────────────────────────────────────────

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(COLORS.fog.getHex(), 0.012);
        this.scene.background = this.createGradientBackground();

        // ─────────────────────────────────────────────────────────────────────
        // CAMERA
        // ─────────────────────────────────────────────────────────────────────

        this.camera = new THREE.PerspectiveCamera(
            55,
            window.innerWidth / window.innerHeight,
            0.1,
            400
        );
        this.camera.position.set(0, 8, 30);
        this.camera.lookAt(0, 10, -30);

        // ─────────────────────────────────────────────────────────────────────
        // RENDERER
        // ─────────────────────────────────────────────────────────────────────

        this.renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: this.getAntialiasEnabled(),
            powerPreference: 'high-performance'
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        container.appendChild(this.renderer.domElement);

        // ─────────────────────────────────────────────────────────────────────
        // MAIN GROUP (for drift animation)
        // ─────────────────────────────────────────────────────────────────────

        this.mainGroup = new THREE.Group();
        this.scene.add(this.mainGroup);

        // ─────────────────────────────────────────────────────────────────────
        // CREATE SCENE ELEMENTS (order matters for depth)
        // ─────────────────────────────────────────────────────────────────────

        this.createStarfield();      // Background stars
        this.createAuroraLayers();   // Aurora in sky
        this.createGodRays();        // Light beams
        this.createTrees();          // Layered trees
        this.createForestFloor();    // Textured ground
        this.createGrass();          // 3D animated grass
        this.createGlowingMushrooms(); // Bioluminescent mushrooms
        this.createMistLayers();     // Atmospheric fog
        this.createSpiritWinds();    // Flowing energy
        this.createFireflySystem();  // Glowing particles
        this.createForestSpirits();  // Ethereal orbs
        // this.createFallingLeavesSystem();  // Disabled - no falling leaves
        this.setupLighting();

        // ─────────────────────────────────────────────────────────────────────
        // EVENT LISTENERS
        // ─────────────────────────────────────────────────────────────────────

        this.setupEventListeners();
        this.setupEventListeners();
        window.addEventListener('resize', this.onWindowResize.bind(this));

        // Listen for resolution changes
        this.handleDisplaySettingsChange = (e) => {
            const { width, height, resolution } = e.detail;
            const mode = resolution === 'auto' ? 'auto' : 'fixed';
            this.setInternalResolution(width, height, mode);
        };
        window.addEventListener('displaySettingsChanged', this.handleDisplaySettingsChange);

        // ─────────────────────────────────────────────────────────────────────
        // START ANIMATION
        // ─────────────────────────────────────────────────────────────────────

        this.animate();

        console.log('[SwedishForest] Scene initialized.');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // GRADIENT BACKGROUND - Dark top to lighter horizon
    // ═══════════════════════════════════════════════════════════════════════════

    createGradientBackground() {
        const canvas = document.createElement('canvas');
        canvas.width = 2;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');

        const gradient = ctx.createLinearGradient(0, 0, 0, 512);
        gradient.addColorStop(0, '#020508');   // Very dark at top
        gradient.addColorStop(0.3, '#051015'); // Dark blue-green
        gradient.addColorStop(0.6, '#0A1820'); // Mid teal
        gradient.addColorStop(0.85, '#152830'); // Lighter
        gradient.addColorStop(1, '#1A3040');   // Teal horizon

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 2, 512);

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;

        return texture;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STARFIELD - Twinkling stars in the night sky
    // ═══════════════════════════════════════════════════════════════════════════

    createStarfield() {
        const starCount = 300;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(starCount * 3);
        const randoms = new Float32Array(starCount);
        const phases = new Float32Array(starCount);
        const brightness = new Float32Array(starCount);

        for (let i = 0; i < starCount; i++) {
            const i3 = i * 3;

            // Spread stars across upper sky dome
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.random() * Math.PI * 0.4; // Upper hemisphere
            const radius = 150 + Math.random() * 50;

            positions[i3] = Math.sin(phi) * Math.cos(theta) * radius;
            positions[i3 + 1] = Math.cos(phi) * radius + 20; // Shift up
            positions[i3 + 2] = Math.sin(phi) * Math.sin(theta) * radius - 80;

            randoms[i] = Math.random();
            phases[i] = Math.random() * Math.PI * 2;
            brightness[i] = 0.3 + Math.random() * 0.7;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uSize: { value: 3.0 },
            },
            vertexShader: starVertexShader,
            fragmentShader: starFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.starfield = new THREE.Points(geometry, material);
        this.scene.add(this.starfield); // Add to scene (not mainGroup) for fixed background
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FOREST FLOOR - Textured ground with moss
    // ═══════════════════════════════════════════════════════════════════════════

    createForestFloor() {
        // Higher subdivision for smoother displacement
        const geometry = new THREE.PlaneGeometry(200, 80, 256, 128);

        // Load forest floor PBR textures
        const textureLoader = new THREE.TextureLoader();

        const albedoMap = textureLoader.load(forestFloorAlbedoUrl);
        const normalMap = textureLoader.load(forestFloorNormalUrl);
        const roughnessMap = textureLoader.load(forestFloorRoughnessUrl);
        const heightMap = textureLoader.load(forestFloorHeightUrl);
        const aoMap = textureLoader.load(forestFloorAoUrl);

        // Configure texture tiling and wrapping for seamless repeat
        const textureRepeat = 6;
        [albedoMap, normalMap, roughnessMap, heightMap, aoMap].forEach(texture => {
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.repeat.set(textureRepeat, textureRepeat * 0.4);
        });

        // Set proper color spaces
        albedoMap.colorSpace = THREE.SRGBColorSpace;
        normalMap.colorSpace = THREE.LinearSRGBColorSpace;
        roughnessMap.colorSpace = THREE.LinearSRGBColorSpace;
        heightMap.colorSpace = THREE.LinearSRGBColorSpace;
        aoMap.colorSpace = THREE.LinearSRGBColorSpace;

        // Create brighter procedural environment cubemap for spirit/sky reflections
        const envMapSize = 64;
        const envMapData = new Uint8Array(envMapSize * envMapSize * 4 * 6);
        for (let face = 0; face < 6; face++) {
            for (let y = 0; y < envMapSize; y++) {
                for (let x = 0; x < envMapSize; x++) {
                    const i = (face * envMapSize * envMapSize + y * envMapSize + x) * 4;
                    // Brighter teal/cyan atmosphere for better reflections
                    const yFactor = y / envMapSize;
                    envMapData[i] = Math.floor(30 + yFactor * 50);      // R - brighter
                    envMapData[i + 1] = Math.floor(80 + yFactor * 80);  // G - much brighter  
                    envMapData[i + 2] = Math.floor(90 + yFactor * 90);  // B - cyan tint
                    envMapData[i + 3] = 255;
                }
            }
        }
        const envCubeTexture = new THREE.DataTexture(envMapData, envMapSize, envMapSize * 6);
        envCubeTexture.needsUpdate = true;

        // Use MeshPhysicalMaterial for advanced PBR with reflections
        const material = new THREE.MeshPhysicalMaterial({
            map: albedoMap,
            normalMap: normalMap,
            normalScale: new THREE.Vector2(3.0, 3.0), // Strong normal for maximum depth
            roughnessMap: roughnessMap,
            roughness: 0.6, // Lower roughness = more reflective for dew/moisture
            metalness: 0.05, // Slight metalness for better reflections
            // Ambient occlusion - reduced to prevent too much darkening
            aoMap: aoMap,
            aoMapIntensity: 0.5,
            // Displacement creates real 3D undulations  
            displacementMap: heightMap,
            displacementScale: 2.5, // Stronger displacement for visible terrain
            displacementBias: -1.0,
            // Sheen for soft moss-like sheen effect
            sheen: 0.5, // Stronger sheen
            sheenColor: new THREE.Color(0x4a8a6a), // Brighter forest green sheen
            sheenRoughness: 0.6,
            // Environment reflections - stronger for spirit light pickup
            envMapIntensity: 0.8,
            // Emissive for visibility - brighter
            emissive: new THREE.Color(0x1a3025), // Brighter forest green
            emissiveMap: albedoMap,
            emissiveIntensity: 0.35, // Stronger emissive glow
            // Color tint - brighter to catch more light
            color: new THREE.Color(0x8aaa9a), // Brighter tint
            side: THREE.DoubleSide,
        });

        // Add UV2 for AO map
        geometry.setAttribute('uv2', geometry.attributes.uv);

        this.groundPlane = new THREE.Mesh(geometry, material);
        this.groundPlane.rotation.x = -Math.PI / 2;
        this.groundPlane.position.set(0, -0.5, -10);
        this.groundPlane.receiveShadow = true;

        this.mainGroup.add(this.groundPlane);

        // Store material reference for potential glow effects
        this.groundMaterial = material;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 3D ANIMATED GRASS - Billboard clumps with wind animation
    // ═══════════════════════════════════════════════════════════════════════════

    createGrass() {
        if (!this.scene) return;

        // Generate procedural grass texture
        const grassTexture = this.createGrassTexture();

        // Billboard geometry - 4 quads at 45° intervals for fluffy look
        const clumpSize = 2.5;
        const clumpHeight = 0.8;
        const numPlanes = 4;

        const positions = [];
        const uvs = [];
        const normals = [];

        const uvTop = 0.85;

        for (let i = 0; i < numPlanes; i++) {
            const angle = (i / numPlanes) * Math.PI;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            const halfSize = clumpSize / 2;

            // Two triangles per plane
            positions.push(-halfSize * cos, 0, -halfSize * sin);
            positions.push(halfSize * cos, 0, halfSize * sin);
            positions.push(halfSize * cos, clumpHeight, halfSize * sin);
            positions.push(-halfSize * cos, 0, -halfSize * sin);
            positions.push(halfSize * cos, clumpHeight, halfSize * sin);
            positions.push(-halfSize * cos, clumpHeight, -halfSize * sin);

            uvs.push(0, 0, 1, 0, 1, uvTop);
            uvs.push(0, 0, 1, uvTop, 0, uvTop);

            for (let j = 0; j < 6; j++) {
                normals.push(0, 1, 0);
            }
        }

        const clumpGeo = new THREE.BufferGeometry();
        clumpGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
        clumpGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
        clumpGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));

        // Forest grass shader material - dark mossy colors
        const grassMat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uWindStrength: { value: 0.15 },
                uGrassTexture: { value: grassTexture },
                uBaseColor: { value: new THREE.Color(0x0a1a10) },  // Very dark moss
                uTipColor: { value: new THREE.Color(0x2a4a35) },   // Dark forest green
                uFogColor: { value: COLORS.fog },
                uSpiritGlow: { value: 0.0 }, // Reactive to spirits
            },
            vertexShader: `
                uniform float uTime;
                uniform float uWindStrength;
                uniform float uSpiritGlow;

                varying vec2 vUv;
                varying float vFogDepth;
                varying float vGlow;

                void main() {
                    vUv = uv;
                    vec3 pos = position;

                    #ifdef USE_INSTANCING
                        vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
                    #else
                        vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    #endif

                    // Wind animation
                    float windPhase = worldPos.x * 0.3 + worldPos.z * 0.25 + uTime * 1.5;
                    float wind = sin(windPhase) * uWindStrength;
                    float wind2 = sin(windPhase * 0.6 + 1.5) * uWindStrength * 0.6;

                    float heightFactor = uv.y * uv.y;
                    pos.x += wind * heightFactor;
                    pos.z += wind2 * heightFactor;

                    // Spirit glow effect - tips glow when spirits are nearby
                    float glowPattern = sin(worldPos.x * 0.2) * sin(worldPos.z * 0.15) * 0.5 + 0.5;
                    vGlow = glowPattern * heightFactor * uSpiritGlow;

                    #ifdef USE_INSTANCING
                        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
                    #else
                        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                    #endif

                    vFogDepth = -mvPosition.z;
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform sampler2D uGrassTexture;
                uniform vec3 uBaseColor;
                uniform vec3 uTipColor;
                uniform vec3 uFogColor;

                varying vec2 vUv;
                varying float vFogDepth;
                varying float vGlow;

                void main() {
                    vec4 texColor = texture2D(uGrassTexture, vUv);
                    if (texColor.a < 0.5) discard;

                    // Dark base to lighter tips gradient
                    float gradient = smoothstep(0.0, 0.7, vUv.y);
                    vec3 grassColor = mix(uBaseColor, uTipColor, gradient);

                    vec3 finalColor = grassColor * texColor.rgb * 1.3;

                    // Add cool moonlight tint at tips
                    vec3 moonTint = vec3(0.6, 0.8, 0.9);
                    finalColor = mix(finalColor, finalColor * moonTint, gradient * 0.3);

                    // Add spirit glow (teal)
                    finalColor += vec3(0.2, 0.8, 0.6) * vGlow * 0.4;

                    // Fog
                    float fogFactor = smoothstep(15.0, 60.0, vFogDepth);
                    finalColor = mix(finalColor, uFogColor, fogFactor);

                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `,
            side: THREE.DoubleSide,
            depthWrite: true,
            alphaTest: 0.5,
        });

        this.grassMaterial = grassMat;

        // Create instanced grass mesh
        const grassCount = 400;
        const grassMesh = new THREE.InstancedMesh(clumpGeo, grassMat, grassCount);
        const dummy = new THREE.Object3D();

        for (let i = 0; i < grassCount; i++) {
            // Distribute in a fan pattern in front of camera
            const angle = (Math.random() - 0.5) * Math.PI * 0.8;
            const dist = 3 + Math.random() * 45;

            const x = Math.sin(angle) * dist;
            const z = -5 - Math.cos(angle) * dist * 0.5;

            dummy.position.set(x, -0.5, z);
            dummy.rotation.y = Math.random() * Math.PI * 2;

            const scale = 0.6 + Math.random() * 0.6;
            dummy.scale.set(scale, scale * (0.8 + Math.random() * 0.4), scale);

            dummy.updateMatrix();
            grassMesh.setMatrixAt(i, dummy.matrix);
        }

        grassMesh.instanceMatrix.needsUpdate = true;
        grassMesh.frustumCulled = false;

        this.mainGroup.add(grassMesh);
        this.grassMesh = grassMesh;
    }

    createGrassTexture() {
        const canvas = document.createElement('canvas');
        const size = 512;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        ctx.clearRect(0, 0, size, size);

        // Draw multiple grass blades
        const bladeCount = 20;
        for (let i = 0; i < bladeCount; i++) {
            const x = (i / bladeCount) * size + (Math.random() - 0.5) * 30;
            const height = size * (0.6 + Math.random() * 0.35);
            const baseWidth = 8 + Math.random() * 6;
            const lean = (Math.random() - 0.5) * 40;

            // Gradient from dark base to lighter tip
            const gradient = ctx.createLinearGradient(x, size, x + lean, size - height);
            gradient.addColorStop(0, '#0a1510');
            gradient.addColorStop(0.3, '#1a3020');
            gradient.addColorStop(0.6, '#2a4530');
            gradient.addColorStop(1.0, '#4a7555');

            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.moveTo(x - baseWidth / 2, size);
            ctx.lineTo(x + baseWidth / 2, size);

            // Curved blade with bezier
            const midX = x + lean * 0.6;
            const midY = size - height * 0.5;
            const tipX = x + lean;
            const tipY = size - height;

            ctx.quadraticCurveTo(midX + baseWidth * 0.3, midY, tipX, tipY);
            ctx.quadraticCurveTo(midX - baseWidth * 0.3, midY, x - baseWidth / 2, size);
            ctx.fill();
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        return texture;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // GLOWING MUSHROOMS - Bioluminescent fungi
    // ═══════════════════════════════════════════════════════════════════════════

    createGlowingMushrooms() {
        this.mushrooms = [];
        this.mushroomLights = [];

        // Mushroom positions - scattered around the forest floor
        // Hue 0.08-0.12 = warm amber/gold matching fireflies
        const mushroomData = [
            { x: -8, z: 2, scale: 0.4, hue: 0.08 },
            { x: 12, z: -5, scale: 0.5, hue: 0.10 },
            { x: -15, z: -8, scale: 0.35, hue: 0.09 },
            { x: 5, z: 5, scale: 0.45, hue: 0.11 },
            { x: -3, z: -3, scale: 0.3, hue: 0.08 },
            { x: 18, z: 0, scale: 0.4, hue: 0.12 },
            { x: -20, z: 3, scale: 0.5, hue: 0.07 },
            { x: 8, z: 8, scale: 0.35, hue: 0.10 },
            { x: -12, z: 6, scale: 0.4, hue: 0.11 },
            { x: 15, z: -10, scale: 0.45, hue: 0.09 },
        ];

        mushroomData.forEach((data, idx) => {
            // Create mushroom geometry - cap and stem
            const capGeo = new THREE.SphereGeometry(1, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.6);
            const stemGeo = new THREE.CylinderGeometry(0.2, 0.3, 0.6, 6);

            // Bioluminescent material with emissive glow
            const glowColor = new THREE.Color().setHSL(data.hue, 0.8, 0.5);
            const emissiveColor = new THREE.Color().setHSL(data.hue, 0.9, 0.4);

            const capMat = new THREE.MeshStandardMaterial({
                color: glowColor,
                emissive: emissiveColor,
                emissiveIntensity: 1.5,
                roughness: 0.3,
                metalness: 0.1,
                transparent: true,
                opacity: 0.9,
            });

            const stemMat = new THREE.MeshStandardMaterial({
                color: 0x3a4a40,
                emissive: emissiveColor,
                emissiveIntensity: 0.3,
                roughness: 0.8,
            });

            const cap = new THREE.Mesh(capGeo, capMat);
            cap.scale.y = 0.5; // Flatten the cap
            cap.position.y = 0.6;

            const stem = new THREE.Mesh(stemGeo, stemMat);
            stem.position.y = 0.3;

            // Group mushroom parts
            const mushroom = new THREE.Group();
            mushroom.add(cap);
            mushroom.add(stem);

            mushroom.position.set(data.x, -0.5, data.z);
            mushroom.scale.setScalar(data.scale);
            mushroom.rotation.y = Math.random() * Math.PI * 2;

            // Store for animation
            mushroom.userData = {
                baseEmissive: 1.5,
                phase: idx * 0.7,
                capMat: capMat,
            };

            this.mushrooms.push(mushroom);
            this.mainGroup.add(mushroom);

            // Add subtle point light for each mushroom
            const light = new THREE.PointLight(glowColor, 0.3, 8, 2);
            light.position.set(data.x, 0.5, data.z);
            this.mushroomLights.push(light);
            this.mainGroup.add(light);
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // LAYERED SPRUCE TREES - InstancedMesh Optimization (2 draw calls vs 400+)
    // ═══════════════════════════════════════════════════════════════════════════

    createTrees() {
        // Layer configurations - trees arranged by depth
        const layers = [
            { count: 20, z: -2, height: 16, spacing: 8, colorIdx: 0, sway: 0.35 },   // Front
            { count: 22, z: -12, height: 22, spacing: 9, colorIdx: 1, sway: 0.30 },  // Mid-front
            { count: 20, z: -25, height: 30, spacing: 11, colorIdx: 2, sway: 0.25 }, // Mid-back
            { count: 18, z: -45, height: 42, spacing: 14, colorIdx: 3, sway: 0.20 }, // Back
        ];

        // Calculate total tree count
        const totalTreeCount = layers.reduce((sum, layer) => sum + layer.count, 0);
        console.log(`[SwedishForest] Creating ${totalTreeCount} trees with InstancedMesh optimization`);

        // Generate ONE merged spruce geometry (foliage + trunk will be separate)
        const { foliageGeometry, trunkGeometry } = this.createMergedSpruceGeometry();

        // Create per-instance attribute arrays
        const instanceColors = new Float32Array(totalTreeCount * 3);
        const instanceSways = new Float32Array(totalTreeCount);
        const instancePhases = new Float32Array(totalTreeCount);
        const trunkColors = new Float32Array(totalTreeCount * 3);

        // Create instanced meshes
        const foliageMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uGlowIntensity: this.uniforms.glowIntensity,
            },
            vertexShader: instancedFoliageVertexShader,
            fragmentShader: instancedFoliageFragmentShader,
            side: THREE.DoubleSide,
        });

        const trunkMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uGlowIntensity: this.uniforms.glowIntensity,
            },
            vertexShader: instancedTrunkVertexShader,
            fragmentShader: instancedTrunkFragmentShader,
        });

        this.foliageInstancedMesh = new THREE.InstancedMesh(foliageGeometry, foliageMaterial, totalTreeCount);
        this.trunkInstancedMesh = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, totalTreeCount);

        // Set up transforms and per-instance data
        const matrix = new THREE.Matrix4();
        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        const scale = new THREE.Vector3();

        let instanceIdx = 0;

        layers.forEach((layer, layerIdx) => {
            const treeColor = COLORS.treeLayers[layerIdx];
            const trunkColor = COLORS.trunkLayers[layerIdx];

            for (let i = 0; i < layer.count; i++) {
                const x = (i - layer.count / 2) * layer.spacing + (Math.random() - 0.5) * 5;
                const z = layer.z + (Math.random() - 0.5) * 3;
                const y = 0;

                // Random scale variation
                const scaleVal = 0.7 + Math.random() * 0.5;
                const heightScale = layer.height / 20; // Normalize to base height of 20

                position.set(x, y, z);
                quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 0.2);
                scale.set(scaleVal, scaleVal * heightScale, scaleVal);

                matrix.compose(position, quaternion, scale);
                this.foliageInstancedMesh.setMatrixAt(instanceIdx, matrix);
                this.trunkInstancedMesh.setMatrixAt(instanceIdx, matrix);

                // Per-instance color (foliage)
                instanceColors[instanceIdx * 3] = treeColor.r;
                instanceColors[instanceIdx * 3 + 1] = treeColor.g;
                instanceColors[instanceIdx * 3 + 2] = treeColor.b;

                // Per-instance trunk color
                trunkColors[instanceIdx * 3] = trunkColor.r;
                trunkColors[instanceIdx * 3 + 1] = trunkColor.g;
                trunkColors[instanceIdx * 3 + 2] = trunkColor.b;

                // Per-instance sway amount
                instanceSways[instanceIdx] = layer.sway;

                // Per-instance random phase for wind variation
                instancePhases[instanceIdx] = Math.random() * Math.PI * 2;

                instanceIdx++;
            }
        });

        // Set up instanced buffer attributes
        foliageGeometry.setAttribute('aInstanceColor',
            new THREE.InstancedBufferAttribute(instanceColors, 3));
        foliageGeometry.setAttribute('aInstanceSway',
            new THREE.InstancedBufferAttribute(instanceSways, 1));
        foliageGeometry.setAttribute('aInstancePhase',
            new THREE.InstancedBufferAttribute(instancePhases, 1));

        trunkGeometry.setAttribute('aInstanceColor',
            new THREE.InstancedBufferAttribute(trunkColors, 3));

        this.foliageInstancedMesh.instanceMatrix.needsUpdate = true;
        this.trunkInstancedMesh.instanceMatrix.needsUpdate = true;

        this.mainGroup.add(this.trunkInstancedMesh);
        this.mainGroup.add(this.foliageInstancedMesh);

        console.log(`[SwedishForest] Trees created: ${totalTreeCount} instances (2 draw calls)`);
    }

    /**
     * Create a merged spruce tree geometry with all foliage layers combined
     * This geometry is shared across all instances
     */
    createMergedSpruceGeometry() {
        const foliageLayers = [];
        const numLayers = 5;  // 5 layers of cones
        const baseHeight = 20; // Normalized base height
        const trunkHeight = baseHeight * 0.15;
        const maxRadius = baseHeight * 0.25; // Base width of the widest cone

        // Create foliage layers (Cones)
        for (let j = 0; j < numLayers; j++) {
            // Tapering logic: Bottom layer is widest, top is narrowest
            const layerProgress = j / (numLayers - 1); // 0 at bottom, 1 at top

            const bottomRadius = maxRadius * (1.0 - layerProgress * 0.8);
            const coneHeight = (baseHeight / numLayers) * 1.8; // Overlap layers

            // Position: Stack them up
            const y = trunkHeight + (j * (baseHeight * 0.85 / numLayers));

            // Create 3D Cone for this layer
            // radialSegments: 7 for a nice low-poly geometric look, or 16 for smooth
            const geometry = new THREE.ConeGeometry(bottomRadius, coneHeight, 7);

            // Translate to correct position (Cone origin is at center)
            geometry.translate(0, y + coneHeight / 2, 0);

            foliageLayers.push(geometry);
        }

        // Merge all foliage layers into one geometry
        const foliageGeometry = BufferGeometryUtils.mergeGeometries(foliageLayers, false);

        // Compute normals for proper 3D lighting
        foliageGeometry.computeVertexNormals();

        // Create trunk geometry (cylinder)
        const trunkGeometry = new THREE.CylinderGeometry(0.2, 0.4, trunkHeight, 6);
        trunkGeometry.translate(0, trunkHeight / 2, 0);
        trunkGeometry.computeVertexNormals();

        // Clean up individual layer geometries
        foliageLayers.forEach(geo => geo.dispose());

        return { foliageGeometry, trunkGeometry };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MIST LAYERS - Atmospheric ground fog
    // ═══════════════════════════════════════════════════════════════════════════

    createMistLayers() {
        const mistConfigs = [
            { y: 2, z: 8, width: 100, height: 10, density: 0.35 },
            { y: 4, z: -8, width: 120, height: 14, density: 0.3 },
            { y: 6, z: -22, width: 140, height: 18, density: 0.25 },
        ];

        for (const config of mistConfigs) {
            const geometry = new THREE.PlaneGeometry(config.width, config.height);

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: this.uniforms.time,
                    uDensity: { value: config.density },
                    uMistColor: { value: COLORS.mist },
                    uIntensity: this.uniforms.mistIntensity,
                },
                vertexShader: mistVertexShader,
                fragmentShader: mistFragmentShader,
                transparent: true,
                blending: THREE.NormalBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            });

            const mist = new THREE.Mesh(geometry, material);
            mist.position.set(0, config.y, config.z);
            mist.rotation.x = -0.15;

            this.mistPlanes.push(mist);
            this.mainGroup.add(mist);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // GOD RAYS - Light beams through trees
    // ═══════════════════════════════════════════════════════════════════════════

    createGodRays() {
        const rayCount = 10;

        for (let i = 0; i < rayCount; i++) {
            const width = 4 + Math.random() * 5;
            const height = 45 + Math.random() * 25;

            const geometry = new THREE.PlaneGeometry(width, height);

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: this.uniforms.time,
                    uOpacity: { value: 0.12 + Math.random() * 0.08 },
                    uRayColor: { value: COLORS.godRay },
                },
                vertexShader: godRayVertexShader,
                fragmentShader: godRayFragmentShader,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            });

            const ray = new THREE.Mesh(geometry, material);
            ray.position.set(
                (Math.random() - 0.5) * 70,
                height / 2 + 8,
                -15 - Math.random() * 35
            );
            ray.rotation.z = (Math.random() - 0.5) * 0.25;

            ray.userData = {
                baseX: ray.position.x,
                swayPhase: Math.random() * Math.PI * 2,
                swaySpeed: 0.2 + Math.random() * 0.15,
            };

            this.godRays.push(ray);
            this.mainGroup.add(ray);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FIREFLIES - Glowing particle system
    // ═══════════════════════════════════════════════════════════════════════════

    createFireflySystem() {
        const fireflyCount = 50;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(fireflyCount * 3);
        const randoms = new Float32Array(fireflyCount);
        const phases = new Float32Array(fireflyCount);
        const velocities = new Float32Array(fireflyCount * 3);

        for (let i = 0; i < fireflyCount; i++) {
            const i3 = i * 3;

            positions[i3] = (Math.random() - 0.5) * 70;
            positions[i3 + 1] = 3 + Math.random() * 18;
            positions[i3 + 2] = -5 - Math.random() * 40;

            randoms[i] = Math.random();
            phases[i] = Math.random() * Math.PI * 2;

            velocities[i3] = (Math.random() - 0.5) * 0.4;
            velocities[i3 + 1] = (Math.random() - 0.5) * 0.25;
            velocities[i3 + 2] = (Math.random() - 0.5) * 0.15;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aVelocity', new THREE.BufferAttribute(velocities, 3));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uSize: { value: 10.0 },
            },
            vertexShader: fireflyVertexShader,
            fragmentShader: fireflyFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.fireflySystem = new THREE.Points(geometry, material);
        this.mainGroup.add(this.fireflySystem);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FOREST SPIRITS - Larger, more visible ethereal orbs
    // ═══════════════════════════════════════════════════════════════════════════

    createForestSpirits() {
        const spiritCount = 12;

        for (let i = 0; i < spiritCount; i++) {
            const size = 4 + Math.random() * 3;
            const geometry = new THREE.PlaneGeometry(size, size);

            // Vary hue for each spirit
            const hueShift = (Math.random() - 0.5) * 0.15;
            const spiritColor = new THREE.Color().setHSL(
                0.42 + hueShift,
                0.75,
                0.7
            );

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: this.uniforms.time,
                    uOpacity: { value: 0.4 + Math.random() * 0.3 },
                    uSpiritColor: { value: spiritColor },
                },
                vertexShader: spiritVertexShader,
                fragmentShader: spiritFragmentShader,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            });

            const spirit = new THREE.Mesh(geometry, material);
            spirit.position.set(
                (Math.random() - 0.5) * 60,
                6 + Math.random() * 15,
                -8 - Math.random() * 30
            );

            spirit.userData = {
                basePosition: spirit.position.clone(),
                targetX: spirit.position.x,
                targetY: spirit.position.y,
                velocity: new THREE.Vector2(0, 0),
                wanderPhase: Math.random() * 100,
            };

            spirit.lookAt(this.camera.position);

            this.spirits.push(spirit);
            this.mainGroup.add(spirit);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // AURORA BOREALIS - Combo effect in sky
    // ═══════════════════════════════════════════════════════════════════════════

    createAuroraLayers() {
        const auroraConfigs = [
            { offset: 0, color1: COLORS.aurora1, color2: COLORS.aurora2, color3: COLORS.aurora3 },
            { offset: 1.5, color1: COLORS.aurora2, color2: COLORS.aurora3, color3: COLORS.aurora1 },
            { offset: 3.0, color1: COLORS.aurora3, color2: COLORS.aurora1, color3: COLORS.aurora2 },
        ];

        for (const config of auroraConfigs) {
            const geometry = new THREE.PlaneGeometry(150, 30, 32, 8);

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: this.uniforms.time,
                    uIntensity: this.uniforms.auroraIntensity,
                    uColor1: { value: config.color1 },
                    uColor2: { value: config.color2 },
                    uColor3: { value: config.color3 },
                    uOffset: { value: config.offset },
                },
                vertexShader: auroraVertexShader,
                fragmentShader: auroraFragmentShader,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            });

            const aurora = new THREE.Mesh(geometry, material);
            aurora.position.set(0, 45 + config.offset * 4, -80);
            aurora.rotation.x = 0.25;

            this.auroraPlanes.push(aurora);
            this.mainGroup.add(aurora);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SPIRIT WINDS - Flowing energy ribbons
    // ═══════════════════════════════════════════════════════════════════════════

    createSpiritWinds() {
        const windCount = 6;

        for (let i = 0; i < windCount; i++) {
            const width = 50 + Math.random() * 25;
            const height = 2.5 + Math.random() * 2;

            const geometry = new THREE.PlaneGeometry(width, height, 32, 2);

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: this.uniforms.time,
                    uOpacity: { value: 0.3 },
                    uWindColor: { value: COLORS.windColor },
                    uOffset: { value: i * 2.0 },
                },
                vertexShader: spiritWindVertexShader,
                fragmentShader: spiritWindFragmentShader,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            });

            const wind = new THREE.Mesh(geometry, material);
            wind.position.set(
                -60 + Math.random() * 30,
                6 + Math.random() * 12,
                -12 - Math.random() * 25
            );
            wind.rotation.z = (Math.random() - 0.5) * 0.2;

            wind.userData = {
                baseX: wind.position.x,
                speed: 0.6 + Math.random() * 0.3,
            };

            this.spiritWinds.push(wind);
            this.mainGroup.add(wind);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FALLING LEAVES
    // ═══════════════════════════════════════════════════════════════════════════

    createFallingLeavesSystem() {
        const maxLeaves = 50;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(maxLeaves * 3);
        const randoms = new Float32Array(maxLeaves);
        const phases = new Float32Array(maxLeaves);
        const velocities = new Float32Array(maxLeaves * 3);
        const rotations = new Float32Array(maxLeaves);

        for (let i = 0; i < maxLeaves; i++) {
            const i3 = i * 3;
            positions[i3] = (Math.random() - 0.5) * 60;
            positions[i3 + 1] = 60 + Math.random() * 20;
            positions[i3 + 2] = -10 - Math.random() * 30;

            randoms[i] = Math.random();
            phases[i] = Math.random() * Math.PI * 2;

            velocities[i3] = (Math.random() - 0.5) * 0.3;
            velocities[i3 + 1] = 1.5 + Math.random() * 1.0;
            velocities[i3 + 2] = (Math.random() - 0.5) * 0.2;

            rotations[i] = Math.random() * Math.PI * 2;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aVelocity', new THREE.BufferAttribute(velocities, 3));
        geometry.setAttribute('aRotation', new THREE.BufferAttribute(rotations, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uSize: { value: 10.0 },
            },
            vertexShader: leafVertexShader,
            fragmentShader: leafFragmentShader,
            transparent: true,
            blending: THREE.NormalBlending,
            depthWrite: false,
        });

        this.fallingLeaves = new THREE.Points(geometry, material);
        this.fallingLeaves.userData = {
            activeLeaves: 0,
            startTime: 0,
        };
        this.mainGroup.add(this.fallingLeaves);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // LIGHTING - Enhanced for more depth
    // ═══════════════════════════════════════════════════════════════════════════

    setupLighting() {
        // Subtle ambient with cool tint
        const ambient = new THREE.AmbientLight(0x0A1520, 0.3);
        this.scene.add(ambient);

        // Moonlight from above-behind
        const moonLight = new THREE.DirectionalLight(0x304050, 0.4);
        moonLight.position.set(0, 40, -50);
        this.scene.add(moonLight);

        // Rim light for tree silhouettes
        const rimLight = new THREE.DirectionalLight(0x2A4050, 0.25);
        rimLight.position.set(-30, 10, 20);
        this.scene.add(rimLight);

        // Hemisphere light for subtle color variation
        const hemiLight = new THREE.HemisphereLight(
            0x1A2535,  // Sky - cool blue
            0x0A1510,  // Ground - dark green
            0.35
        );
        this.scene.add(hemiLight);

        // Subtle point light in center for spirit glow
        const spiritGlow = new THREE.PointLight(0x40A080, 0.4, 50);
        spiritGlow.position.set(0, 10, -15);
        this.mainGroup.add(spiritGlow);
        this.spiritLight = spiritGlow;

        // Floor illumination light - enhances normal map depth on ground
        const floorLight = new THREE.DirectionalLight(0x3a5a4a, 0.6);
        floorLight.position.set(0, 30, 10);
        floorLight.target.position.set(0, 0, -20);
        this.scene.add(floorLight);
        this.scene.add(floorLight.target);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // GAMEPLAY EVENT HANDLERS
    // ═══════════════════════════════════════════════════════════════════════════

    setupEventListeners() {
        this.eventUnsubscribers.forEach(unsub => unsub?.());
        this.eventUnsubscribers = [];

        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onLineClear(data.lineCount || 1);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onCombo(data.comboCount || 0);
            }
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onPieceLock(data);
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
    }

    onLineClear(lineCount) {
        this.targetGlowIntensity = Math.min(lineCount * 0.35, 1.0);
        this.targetMistIntensity = Math.min(0.6 + lineCount * 0.12, 1.0);

        this.spawnLeaves(lineCount * 4);

        this.spirits.forEach(spirit => {
            spirit.userData.velocity.x += (Math.random() - 0.5) * 2.5;
            spirit.userData.velocity.y += (Math.random() - 0.5) * 2.5;
            spirit.material.uniforms.uOpacity.value = Math.min(
                spirit.material.uniforms.uOpacity.value + 0.25,
                0.95
            );
        });

        // Boost spirit light
        if (this.spiritLight) {
            this.spiritLight.intensity = 0.8 + lineCount * 0.2;
        }
    }

    onCombo(comboCount) {
        if (comboCount < 1) return;

        this.comboMultiplier = Math.min(1 + comboCount * 0.3, 3.0);
        this.targetGlowIntensity = Math.min(comboCount * 0.3, 1.0);
        this.targetWindSpeed = Math.min(comboCount * 0.012, 0.06);

        if (comboCount >= 3) {
            this.targetAuroraIntensity = Math.min(comboCount * 0.18, 0.9);
        }

        if (this.comboMultiplier > 1.5) {
            const centerX = 0;
            const centerY = 12;
            this.spirits.forEach(spirit => {
                spirit.userData.velocity.x += (centerX - spirit.position.x) * 0.012 * this.comboMultiplier;
                spirit.userData.velocity.y += (centerY - spirit.position.y) * 0.012 * this.comboMultiplier;
            });
        }
    }

    onPieceLock(data) {
        this.targetGlowIntensity += 0.1;
        this.mushroomPulse = 1.5; // Strong pulse on lock

        this.spirits.forEach(spirit => {
            spirit.material.uniforms.uOpacity.value += 0.06;
        });
    }

    spawnLeaves(count) {
        if (!this.fallingLeaves) return;

        const positions = this.fallingLeaves.geometry.attributes.position.array;
        const start = this.fallingLeaves.userData.activeLeaves;
        const maxLeaves = positions.length / 3;

        this.fallingLeaves.userData.startTime = this.uniforms.time.value;
        this.fallingLeaves.material.uniforms.uTime.value = 0;

        for (let i = 0; i < count && (start + i) < maxLeaves; i++) {
            const idx = ((start + i) % maxLeaves) * 3;
            positions[idx] = (Math.random() - 0.5) * 70;
            positions[idx + 1] = 45 + Math.random() * 15;
            positions[idx + 2] = -8 - Math.random() * 35;
        }

        this.fallingLeaves.geometry.attributes.position.needsUpdate = true;
        this.fallingLeaves.userData.activeLeaves = Math.min(start + count, maxLeaves);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ANIMATION LOOP
    // ═══════════════════════════════════════════════════════════════════════════

    animate() {
        if (!this.isActive) return;

        this.animationFrame = requestAnimationFrame(this.animate.bind(this));

        const delta = this.clock.getDelta();
        const elapsed = this.clock.getElapsedTime();
        this.uniforms.time.value = elapsed;

        // ─────────────────────────────────────────────────────────────────────
        // SMOOTH EFFECT TRANSITIONS
        // ─────────────────────────────────────────────────────────────────────

        this.uniforms.glowIntensity.value = THREE.MathUtils.lerp(
            this.uniforms.glowIntensity.value,
            this.targetGlowIntensity,
            delta * 3
        );
        this.targetGlowIntensity *= 0.95;

        this.uniforms.mistIntensity.value = THREE.MathUtils.lerp(
            this.uniforms.mistIntensity.value,
            this.targetMistIntensity,
            delta * 2
        );
        if (this.targetMistIntensity > 0.6) {
            this.targetMistIntensity -= delta * 0.04;
        }

        this.uniforms.auroraIntensity.value = THREE.MathUtils.lerp(
            this.uniforms.auroraIntensity.value,
            this.targetAuroraIntensity,
            delta * 2
        );
        this.targetAuroraIntensity *= 0.97;

        this.uniforms.windSpeed.value = THREE.MathUtils.lerp(
            this.uniforms.windSpeed.value,
            this.targetWindSpeed,
            delta * 2
        );
        this.targetWindSpeed *= 0.96;

        this.comboMultiplier = Math.max(1, this.comboMultiplier - delta * 0.25);

        // Spirit light decay
        if (this.spiritLight && this.spiritLight.intensity > 0.4) {
            this.spiritLight.intensity -= delta * 0.2;
        }

        // ─────────────────────────────────────────────────────────────────────
        // MAIN GROUP DRIFT - very subtle
        // ─────────────────────────────────────────────────────────────────────

        const driftTime = elapsed * 0.025;
        this.mainGroup.position.x = Math.sin(driftTime) * 0.4;
        this.mainGroup.position.y = Math.cos(driftTime * 0.7) * 0.15;
        this.mainGroup.rotation.y = Math.sin(driftTime * 0.5) * 0.005;

        // ─────────────────────────────────────────────────────────────────────
        // CAMERA DREAMY MOVEMENT - slow, atmospheric drift
        // ─────────────────────────────────────────────────────────────────────

        const camTime = elapsed * 0.07;  // Slightly faster dreamy movement
        const baseX = 0;
        const baseY = 8;
        const baseZ = 30;

        // Slow atmospheric sway
        this.camera.position.x = baseX + Math.sin(camTime) * 4.0 + Math.sin(camTime * 0.6) * 2.0;
        this.camera.position.y = baseY + Math.sin(camTime * 0.5 + 1.0) * 1.5;
        this.camera.position.z = baseZ + Math.cos(camTime * 0.4) * 2.5;

        // Gentle look-around for dreamy atmosphere
        const lookX = Math.sin(camTime * 0.7) * 3.0;
        const lookY = 10 + Math.cos(camTime * 0.35) * 1.0;
        this.camera.lookAt(lookX, lookY, -30);

        // ─────────────────────────────────────────────────────────────────────
        // GOD RAY SWAY
        // ─────────────────────────────────────────────────────────────────────

        this.godRays.forEach(ray => {
            ray.position.x = ray.userData.baseX +
                Math.sin(elapsed * ray.userData.swaySpeed + ray.userData.swayPhase) * 1.5;
        });

        // ─────────────────────────────────────────────────────────────────────
        // SPIRIT MOVEMENT
        // ─────────────────────────────────────────────────────────────────────

        this.spirits.forEach(spirit => {
            spirit.userData.wanderPhase += delta * 0.4;

            spirit.userData.targetX += Math.cos(spirit.userData.wanderPhase) * 0.08;
            spirit.userData.targetY += Math.sin(spirit.userData.wanderPhase * 1.3) * 0.04;

            const dx = spirit.userData.targetX - spirit.position.x;
            const dy = spirit.userData.targetY - spirit.position.y;
            spirit.userData.velocity.x += dx * 0.0015;
            spirit.userData.velocity.y += dy * 0.0015;

            spirit.userData.velocity.x *= 0.97;
            spirit.userData.velocity.y *= 0.97;

            spirit.position.x += spirit.userData.velocity.x;
            spirit.position.y += spirit.userData.velocity.y;

            spirit.material.uniforms.uOpacity.value *= 0.997;
            if (spirit.material.uniforms.uOpacity.value < 0.25) {
                spirit.material.uniforms.uOpacity.value = 0.25;
            }

            spirit.lookAt(this.camera.position);
        });

        // ─────────────────────────────────────────────────────────────────────
        // SPIRIT WIND MOVEMENT
        // ─────────────────────────────────────────────────────────────────────

        this.spiritWinds.forEach(wind => {
            wind.position.x += wind.userData.speed * (1 + this.uniforms.windSpeed.value * 25);

            if (wind.position.x > 70) {
                wind.position.x = -70;
                wind.position.y = 6 + Math.random() * 12;
            }
        });

        // ─────────────────────────────────────────────────────────────────────
        // FALLING LEAVES UPDATE
        // ─────────────────────────────────────────────────────────────────────

        if (this.fallingLeaves && this.fallingLeaves.userData.startTime > 0) {
            const leafTime = elapsed - this.fallingLeaves.userData.startTime;
            this.fallingLeaves.material.uniforms.uTime.value = leafTime;

            if (leafTime > 18) {
                this.fallingLeaves.userData.startTime = 0;
                this.fallingLeaves.userData.activeLeaves = 0;
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // GRASS ANIMATION
        // ─────────────────────────────────────────────────────────────────────

        if (this.grassMaterial) {
            this.grassMaterial.uniforms.uTime.value = elapsed;
            // Subtle spirit glow triggered by combo effects
            this.grassMaterial.uniforms.uSpiritGlow.value = THREE.MathUtils.lerp(
                this.grassMaterial.uniforms.uSpiritGlow.value,
                this.uniforms.glowIntensity.value,
                delta * 2
            );
        }

        // ─────────────────────────────────────────────────────────────────────
        // MUSHROOM GLOW ANIMATION
        // ─────────────────────────────────────────────────────────────────────

        // Decay pulse
        this.mushroomPulse *= 0.92;
        if (this.mushroomPulse < 0.01) this.mushroomPulse = 0;

        this.mushrooms.forEach((mushroom, idx) => {
            if (mushroom.userData.capMat) {
                // Pulsing glow effect + Piece Lock Pulse
                const pulse = Math.sin(elapsed * 1.5 + mushroom.userData.phase) * 0.3 + 1.0;
                const comboBoost = 1 + this.uniforms.glowIntensity.value * 2;
                const lockBoost = 1 + this.mushroomPulse * 2.0; // Strong boost from lock

                mushroom.userData.capMat.emissiveIntensity = mushroom.userData.baseEmissive * pulse * comboBoost * lockBoost;
            }
        });

        // Mushroom lights also pulse
        this.mushroomLights.forEach((light, idx) => {
            const pulse = Math.sin(elapsed * 1.5 + idx * 0.7) * 0.15 + 0.3;
            const lockBoost = 1 + this.mushroomPulse * 3.0;
            light.intensity = pulse * (1 + this.uniforms.glowIntensity.value * 1.5) * lockBoost;
        });

        // ─────────────────────────────────────────────────────────────────────
        // RENDER
        // ─────────────────────────────────────────────────────────────────────

        this.renderer.render(this.scene, this.camera);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // WINDOW RESIZE
    // ═══════════════════════════════════════════════════════════════════════════

    onWindowResize() {
        if (!this.camera || !this.renderer) return;

        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();

        if (this.resolutionMode === 'fixed' && this.targetResolution) {
            // FORCE pixel ratio to 1 to ensure we actually render at the requested resolution
            this.renderer.setPixelRatio(1);
            this.renderer.setSize(this.targetResolution.width, this.targetResolution.height, false);

            // We must set the DOM element size to window size (CSS handles this, but ThreeJS might set explicit style)
            this.renderer.domElement.style.width = '100%';
            this.renderer.domElement.style.height = '100%';
        } else {
            // Auto mode: Use native DPR for crispness
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        }
    }

    setInternalResolution(width, height, mode = 'auto') {
        console.log(`[SwedishForest] Setting internal resolution: ${width}x${height} (${mode})`);
        this.targetResolution = { width, height };
        this.resolutionMode = mode;
        this.onWindowResize(); // Apply changes
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CLEANUP
    // ═══════════════════════════════════════════════════════════════════════════

    stop() {
        super.stop();

        this.eventUnsubscribers.forEach(unsub => unsub?.());
        this.eventUnsubscribers = [];

        window.removeEventListener('resize', this.onWindowResize.bind(this));
        window.removeEventListener('displaySettingsChanged', this.handleDisplaySettingsChange);

        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }

        if (this.renderer) {
            this.renderer.dispose();
            const container = document.getElementById('swedish-forest-theme');
            if (container && container.contains(this.renderer.domElement)) {
                container.removeChild(this.renderer.domElement);
            }
        }

        if (this.scene) {
            this.scene.traverse((object) => {
                if (object.geometry) object.geometry.dispose();
                if (object.material) {
                    if (Array.isArray(object.material)) {
                        object.material.forEach(m => m.dispose());
                    } else {
                        object.material.dispose();
                    }
                }
            });
        }

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.mainGroup = null;
        this.foliageInstancedMesh = null;
        this.trunkInstancedMesh = null;
        this.groundPlane = null;
        this.starfield = null;
        this.mistPlanes = [];
        this.godRays = [];
        this.fireflySystem = null;
        this.spirits = [];
        this.auroraPlanes = [];
        this.spiritWinds = [];
        this.fallingLeaves = null;
        this.spiritLight = null;
    }
}
