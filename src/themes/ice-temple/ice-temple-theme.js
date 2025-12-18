/**
 * @fileoverview Ice Temple Theme - Three.js 3D Implementation
 * 
 * Immersive frozen temple with translucent ice pillars, aurora borealis,
 * frost patterns, and dynamic snow. All effects rendered in full 3D.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { ICE_TEMPLE_TETROMINOS } from './ice-temple-tetrominos.js';
import {
    auroraVertexShader,
    auroraFragmentShader,
    snowVertexShader,
    snowFragmentShader,
    iceShardVertexShader,
    iceShardFragmentShader,
    shockwaveVertexShader,
    shockwaveFragmentShader
} from './ice-temple-shaders.js';

// ═══════════════════════════════════════════════════════════════════════════
// THEME CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const COLORS = {
    // Ice colors
    iceBase: new THREE.Color(0x0e3352),      // Deep ice blue
    iceGlow: new THREE.Color(0x74b9ff),      // Bright cyan glow
    iceHighlight: new THREE.Color(0xb4f5ff), // White-cyan highlight

    // Floor colors
    floorIce: new THREE.Color(0x0a1f35),     // Dark frozen floor
    floorCracks: new THREE.Color(0x55efc4),  // Teal crack glow
    floorSnow: new THREE.Color(0xe8fcff),    // Snow white

    // Aurora colors
    aurora1: new THREE.Color(0x74b9ff),      // Cyan
    aurora2: new THREE.Color(0x55efc4),      // Emerald green
    aurora3: new THREE.Color(0xa29bfe),      // Purple

    // Particles
    snow: new THREE.Color(0xe8fcff),
    iceShards: new THREE.Color(0x96d7ff),

    // Fog and ambient
    fog: new THREE.Color(0x051525),
    ambient: new THREE.Color(0x1a3a5c),
};

export default class IceTempleTheme extends BaseTheme {
    constructor() {
        super('ice-temple');

        // Event handling
        this.eventUnsubscribers = [];

        // Three.js components
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.composer = null;  // Post-processing for bloom
        this.mainGroup = null;
        this.clock = new THREE.Clock();
        this.animationFrame = null;

        // Scene elements
        this.icePillars = [];
        this.auroraPlanes = [];
        this.snowSystem = null;
        this.shardBursts = [];
        this.shockwaves = [];
        this.starField = null;
        this.frostFloor = null;

        // Shared uniforms for synchronized animation
        this.uniforms = {
            time: { value: 0 },
            pulseIntensity: { value: 0 },
            crackGlow: { value: 0 },
            auroraIntensity: { value: 0.8 },
        };

        // Effect state
        this.targetPulseIntensity = 0;
        this.targetCrackGlow = 0;
        this.targetAuroraIntensity = 0.8;
    }

    getTetrominoConfig() {
        return ICE_TEMPLE_TETROMINOS;
    }

    async createScene() {
        console.log('[IceTemple] Initializing Three.js scene...');

        const container = document.getElementById('ice-temple-theme');
        if (!container) {
            console.error('[IceTemple] Container not found');
            return;
        }

        // Clean up any existing content
        container.innerHTML = '';

        // ─────────────────────────────────────────────────────────────────────
        // SCENE SETUP
        // ─────────────────────────────────────────────────────────────────────

        this.scene = new THREE.Scene();
        // Reduced fog density for better crystal visibility
        this.scene.fog = new THREE.FogExp2(0x040c14, 0.015);
        this.scene.background = new THREE.Color(0x040c14);

        // ─────────────────────────────────────────────────────────────────────
        // CAMERA
        // ─────────────────────────────────────────────────────────────────────

        this.camera = new THREE.PerspectiveCamera(
            60,
            window.innerWidth / window.innerHeight,
            0.1,
            200
        );
        this.camera.position.set(0, 8, 25);
        this.camera.lookAt(0, 3, 0);

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
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.4;
        container.appendChild(this.renderer.domElement);

        // ─────────────────────────────────────────────────────────────────────
        // POST-PROCESSING - Bloom for magical ice glow
        // ─────────────────────────────────────────────────────────────────────

        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        // UnrealBloomPass for ethereal ice glow
        const bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            0.5,   // strength - reduced for balanced glow
            0.3,   // radius - spread of bloom
            0.4    // threshold - raised to reduce over-bloom
        );
        this.composer.addPass(bloomPass);
        this.bloomPass = bloomPass;

        // ─────────────────────────────────────────────────────────────────────
        // MAIN GROUP (for subtle drift animation)
        // ─────────────────────────────────────────────────────────────────────

        this.mainGroup = new THREE.Group();
        this.scene.add(this.mainGroup);

        // ─────────────────────────────────────────────────────────────────────
        // CREATE SCENE ELEMENTS
        // ─────────────────────────────────────────────────────────────────────

        this.createStarField();
        this.createAurora();
        this.createFrostFloor();
        this.createIcePillars();
        this.createSnowSystem();
        this.setupLighting();
        this.createEnvironmentMap();

        // ─────────────────────────────────────────────────────────────────────
        // EVENT LISTENERS
        // ─────────────────────────────────────────────────────────────────────

        this.setupEventListeners();
        window.addEventListener('resize', this.onWindowResize.bind(this));

        // ─────────────────────────────────────────────────────────────────────
        // START ANIMATION
        // ─────────────────────────────────────────────────────────────────────

        this.animate();

        console.log('[IceTemple] Scene initialized.');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STAR FIELD
    // ═══════════════════════════════════════════════════════════════════════════

    createStarField() {
        const starCount = 1500;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(starCount * 3);
        const colors = new Float32Array(starCount * 3);
        const sizes = new Float32Array(starCount);

        const starColors = [
            new THREE.Color(0xffffff),
            new THREE.Color(0xb4f5ff),
            new THREE.Color(0x74b9ff),
        ];

        for (let i = 0; i < starCount; i++) {
            const i3 = i * 3;

            // Hemisphere distribution above camera
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.random() * Math.PI * 0.5;
            const radius = 80 + Math.random() * 50;

            positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = radius * Math.cos(phi) + 10;
            positions[i3 + 2] = radius * Math.sin(phi) * Math.sin(theta) - 30;

            const color = starColors[Math.floor(Math.random() * starColors.length)];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            sizes[i] = 0.5 + Math.random() * 1.5;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        const material = new THREE.PointsMaterial({
            size: 0.8,
            vertexColors: true,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            sizeAttenuation: true,
        });

        this.starField = new THREE.Points(geometry, material);
        this.scene.add(this.starField);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // AURORA BOREALIS - Single unified curtain
    // ═══════════════════════════════════════════════════════════════════════════

    createAurora() {
        // Single wide aurora curtain using cylinder arc geometry for curved sky effect
        // This creates a seamless aurora spanning the entire horizon

        const arcAngle = Math.PI * 1.4;  // ~250 degrees - full left to right coverage
        const radius = 80;               // Larger radius for wider span
        const height = 60;
        const segments = 160;            // Smooth curve

        // Create curved geometry (partial cylinder, open-ended)
        const geometry = new THREE.CylinderGeometry(
            radius,      // top radius
            radius,      // bottom radius  
            height,      // height
            segments,    // radial segments
            64,          // height segments
            true,        // open-ended
            -arcAngle / 2,  // start angle (centered)
            arcAngle     // arc length
        );

        // Rotate to face camera
        geometry.rotateY(Math.PI);

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uIntensity: this.uniforms.auroraIntensity,
                uColor1: { value: COLORS.aurora1 },
                uColor2: { value: COLORS.aurora2 },
                uColor3: { value: COLORS.aurora3 },
            },
            vertexShader: auroraVertexShader,
            fragmentShader: auroraFragmentShader,
            transparent: true,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        const aurora = new THREE.Mesh(geometry, material);
        aurora.position.set(0, 28, -20);  // Move closer and adjust height

        this.auroraPlanes.push(aurora);
        this.scene.add(aurora);

        // ─────────────────────────────────────────────────────────────────
        // AURORA REFLECTION (Under the ice)
        // ─────────────────────────────────────────────────────────────────
        // We create a duplicate flipped aurora below the floor.
        // The floor's PBR transmission/roughness will naturally distort it.

        const reflectionGeometry = geometry.clone();

        const reflectionMaterial = material.clone();
        // Slightly dim the reflection
        reflectionMaterial.uniforms = THREE.UniformsUtils.clone(material.uniforms);
        // We can't easily dim the shader without changing uniforms usage, 
        // but the floor's attenuation will handle the dimming naturally!

        const reflectionAurora = new THREE.Mesh(reflectionGeometry, reflectionMaterial);
        reflectionAurora.position.set(0, -28, -20); // Mirror position across XZ plane (y=0)
        reflectionAurora.scale.y = -1;              // Mirror the geometry vertically

        this.auroraReflections = [reflectionAurora]; // Store for animation updates
        this.scene.add(reflectionAurora);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FROST FLOOR - Circular with PBR ice (transmission + volume)
    // ═══════════════════════════════════════════════════════════════════════════

    createFrostFloor() {
        // Use circular geometry avoiding sharp edges - Large radius to fade efficiently
        const geometry = new THREE.CircleGeometry(140, 64);

        // Load the cracked ice texture as NORMAL MAP (not diffuse - color comes from physics)
        const textureLoader = new THREE.TextureLoader();
        const iceNormalTexture = textureLoader.load(
            new URL('./textures/ice-diffuse.jpg', import.meta.url).href
        );
        iceNormalTexture.wrapS = THREE.MirroredRepeatWrapping;
        iceNormalTexture.wrapT = THREE.MirroredRepeatWrapping;
        iceNormalTexture.repeat.set(3, 3); // Larger cracks, fewer seams

        // Create gradient alpha texture for edge fading
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');

        // Radial gradient from center (opaque) to edge (transparent)
        // Soft fade out starting at 60%
        const gradient = ctx.createRadialGradient(256, 256, 0, 256, 256, 256);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(0.6, 'rgba(255, 255, 255, 0.9)');
        gradient.addColorStop(0.8, 'rgba(255, 255, 255, 0.5)');
        gradient.addColorStop(0.9, 'rgba(255, 255, 255, 0.3)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 512, 512);

        const alphaTexture = new THREE.CanvasTexture(canvas);

        // Floor material with FULL PBR ice settings - Enhanced Blue Tint
        const material = new THREE.MeshPhysicalMaterial({
            // 1. Basic Optical Properties
            color: 0x4488ff,              // Blue surface tint
            roughness: 0.15,              // Low for wet ice
            metalness: 0.1,               // Slight metalness for extra reflection
            transmission: 0.85,           // Glass-like
            ior: 1.31,                    // Index of Refraction for ice

            // 2. Volume / Depth (The Blue Tint)
            thickness: 2.5,               // Thicker for deeper color
            attenuationColor: new THREE.Color(0x0044ff), // Richer blue
            attenuationDistance: 0.5,     // Stronger blue absorption (lower value = bluer)

            // 3. Surface Detail (The "Frost" layer)
            clearcoat: 1.0,               // Polished wet layer
            clearcoatRoughness: 0.05,

            // 4. Texture as normal map for cracks
            normalMap: iceNormalTexture,
            normalScale: new THREE.Vector2(0.5, 0.5), // Deeper cracks

            // 5. Glow and Edges - Enhanced for crystal effect
            emissive: 0x0a2266,           // Subtle blue inner glow
            emissiveIntensity: 0.3,       // Reduced glow

            transparent: true,
            alphaMap: alphaTexture,
            // alphaTest removed to allow soft blending
            depthWrite: false,            // Prevent z-fighting and allow proper blending
            side: THREE.DoubleSide,

            envMapIntensity: 1.5,
        });

        this.frostFloor = new THREE.Mesh(geometry, material);
        this.frostFloor.rotation.x = -Math.PI / 2;
        this.frostFloor.renderOrder = -1; // Draw first to act as background
        this.frostFloor.position.y = 0;
        this.frostFloor.receiveShadow = true;

        this.mainGroup.add(this.frostFloor);
        this.floorMaterial = material;

        // Add mist layers
        this.createMistLayers();
    }

    createIceCracksOverlay() {
        // Circular crack overlay matching the floor
        const crackGeometry = new THREE.CircleGeometry(75, 64);

        // Create crack texture procedurally
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 1024;
        const ctx = canvas.getContext('2d');

        // Transparent background
        ctx.clearRect(0, 0, 1024, 1024);

        // Draw glowing crack network
        ctx.strokeStyle = 'rgba(85, 239, 196, 0.5)';
        ctx.lineWidth = 1.5;
        ctx.shadowColor = 'rgba(85, 239, 196, 0.9)';
        ctx.shadowBlur = 12;

        // Generate organic crack patterns radiating from random points
        for (let i = 0; i < 40; i++) {
            const startX = 256 + (Math.random() - 0.5) * 512;
            const startY = 256 + (Math.random() - 0.5) * 512;

            ctx.beginPath();
            ctx.moveTo(startX, startY);

            let x = startX;
            let y = startY;
            const segments = 4 + Math.floor(Math.random() * 6);

            for (let j = 0; j < segments; j++) {
                const angle = Math.random() * Math.PI * 2;
                const length = 30 + Math.random() * 80;
                x += Math.cos(angle) * length;
                y += Math.sin(angle) * length;
                ctx.lineTo(x, y);

                // Branch occasionally
                if (Math.random() > 0.7) {
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(x, y);
                }
            }
            ctx.stroke();
        }

        // Edge fade gradient
        const fadeGradient = ctx.createRadialGradient(512, 512, 300, 512, 512, 512);
        fadeGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
        fadeGradient.addColorStop(1, 'rgba(0, 0, 0, 1)');
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = fadeGradient;
        ctx.fillRect(0, 0, 1024, 1024);

        const crackTexture = new THREE.CanvasTexture(canvas);

        const crackMaterial = new THREE.MeshBasicMaterial({
            map: crackTexture,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        const crackMesh = new THREE.Mesh(crackGeometry, crackMaterial);
        crackMesh.rotation.x = -Math.PI / 2;
        crackMesh.position.y = 0.03;

        this.mainGroup.add(crackMesh);
        this.crackOverlay = crackMesh;
    }

    createMistLayers() {
        // Add atmospheric mist/fog layers for depth
        const mistColors = [
            { color: 0x1a5577, opacity: 0.15, y: 0.5, scale: 60 },
            { color: 0x2a6688, opacity: 0.1, y: 1.5, scale: 80 },
            { color: 0x3a7799, opacity: 0.08, y: 3, scale: 100 },
        ];

        this.mistLayers = [];

        for (const config of mistColors) {
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');

            // Soft circular gradient
            const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
            gradient.addColorStop(0, `rgba(255, 255, 255, ${config.opacity})`);
            gradient.addColorStop(0.5, `rgba(255, 255, 255, ${config.opacity * 0.6})`);
            gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 256, 256);

            const texture = new THREE.CanvasTexture(canvas);
            const spriteMaterial = new THREE.SpriteMaterial({
                map: texture,
                color: config.color,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });

            const sprite = new THREE.Sprite(spriteMaterial);
            sprite.scale.set(config.scale, config.scale * 0.3, 1);
            sprite.position.y = config.y;

            this.mistLayers.push(sprite);
            this.mainGroup.add(sprite);
        }

        // Add low-lying fog ring around the edges
        this.createFogRing();
    }

    createFogRing() {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');

        // Create ring-shaped fog
        const gradient = ctx.createRadialGradient(256, 256, 100, 256, 256, 256);
        gradient.addColorStop(0, 'rgba(26, 85, 119, 0)');
        gradient.addColorStop(0.4, 'rgba(26, 85, 119, 0)');
        gradient.addColorStop(0.6, 'rgba(42, 102, 136, 0.2)');
        gradient.addColorStop(0.8, 'rgba(58, 119, 153, 0.3)');
        gradient.addColorStop(1, 'rgba(74, 136, 170, 0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 512, 512);

        const texture = new THREE.CanvasTexture(canvas);
        const geometry = new THREE.PlaneGeometry(150, 150);
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        });

        const fogRing = new THREE.Mesh(geometry, material);
        fogRing.rotation.x = -Math.PI / 2;
        fogRing.position.y = 0.2;

        this.fogRing = fogRing;
        this.mainGroup.add(fogRing);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ICE PILLARS
    // ═══════════════════════════════════════════════════════════════════════════

    createIcePillars() {
        const pillarPositions = [
            { x: -12, z: -5, height: 15, radius: 1.2 },
            { x: -8, z: -12, height: 18, radius: 1.5 },
            { x: 8, z: -8, height: 16, radius: 1.3 },
            { x: 14, z: -3, height: 12, radius: 1.0 },
            { x: -5, z: 5, height: 10, radius: 0.9 },
            { x: 6, z: 8, height: 8, radius: 0.8 },
            { x: 0, z: -18, height: 20, radius: 1.8 },
        ];

        for (const config of pillarPositions) {
            const pillar = this.createIcePillar(config);
            this.icePillars.push(pillar);
            this.mainGroup.add(pillar.group);
        }
    }

    createIcePillar(config) {
        const group = new THREE.Group();
        group.position.set(config.x, 0, config.z);

        // ─────────────────────────────────────────────────────────────────────
        // UNIFIED ORGANIC PILLAR (Lathe Geometry)
        // ─────────────────────────────────────────────────────────────────────

        const profilePoints = [];

        // 1. Root Base (Slightly wider but mostly submerged)
        profilePoints.push(new THREE.Vector2(config.radius * 1.5, 0));      // Base
        profilePoints.push(new THREE.Vector2(config.radius * 1.2, 1.0));    // Transition

        // 2. Main Shaft (Straight rise)
        profilePoints.push(new THREE.Vector2(config.radius * 1.0, 4.0));
        profilePoints.push(new THREE.Vector2(config.radius * 0.9, config.height * 0.8));

        // 3. Peak (Sharp tip)
        profilePoints.push(new THREE.Vector2(0, config.height));

        const geometry = new THREE.LatheGeometry(profilePoints, 6);

        // Add random vertex displacement
        const positions = geometry.attributes.position.array;
        const seed = config.x * 100 + config.z;
        for (let i = 0; i < positions.length; i += 3) {
            const y = positions[i + 1];
            const heightFactor = Math.max(0, (y - 0.5) / config.height);
            const noise = Math.sin(seed + y * 0.5 + i * 0.1) * 0.2 * config.radius * heightFactor;

            const angle = Math.atan2(positions[i + 2], positions[i]);
            const r = Math.sqrt(positions[i] * positions[i] + positions[i + 2] * positions[i + 2]);
            const newR = r + noise;
            positions[i] = Math.cos(angle) * newR;
            positions[i + 2] = Math.sin(angle) * newR;
        }
        geometry.computeVertexNormals();

        // ─────────────────────────────────────────────────────────────────────
        // UPLIFTED ICE SHARDS (Breaking the surface)
        // ─────────────────────────────────────────────────────────────────────
        // Create a ring of jagged shards that look like the floor being pushed up

        const shardCount = 8 + Math.floor(Math.random() * 4);
        const shardMaterial = new THREE.MeshPhysicalMaterial({
            color: 0xaaffff,        // Slightly blue-white crystal
            emissive: 0x3388bb,     // Softer blue glow
            emissiveIntensity: 0.4, // Reduced glow
            roughness: 0.1,         // Smooth fracture
            metalness: 0.0,
            transmission: 0.3,      // Semi-transparent crystal
            thickness: 1.0,
            ior: 1.6,               // Crystal refraction
            clearcoat: 1.0,
            clearcoatRoughness: 0.1,
            side: THREE.DoubleSide
        });

        for (let i = 0; i < shardCount; i++) {
            // Irregular shard geometry
            const w = config.radius * (0.8 + Math.random() * 0.6);
            const h = config.radius * (1.5 + Math.random() * 1.0);
            const shardGeo = new THREE.PlaneGeometry(w, h);

            // Displace shard vertices for jagged edges
            const pos = shardGeo.attributes.position.array;
            for (let j = 0; j < pos.length; j += 3) {
                pos[j] += (Math.random() - 0.5) * w * 0.2;
                pos[j + 1] += (Math.random() - 0.5) * h * 0.1;
                pos[j + 2] += (Math.random() - 0.5) * 0.2; // slight depth noise
            }
            shardGeo.computeVertexNormals();

            const shard = new THREE.Mesh(shardGeo, shardMaterial);

            // Position in ring
            const angle = (i / shardCount) * Math.PI * 2 + (Math.random() * 0.4);
            const dist = config.radius * 1.0; // Close to pillar

            shard.position.x = Math.cos(angle) * dist;
            shard.position.z = Math.sin(angle) * dist;
            shard.position.y = 0;

            // Rotate to point UP and OUT
            shard.lookAt(0, 0, 0); // Face center first
            shard.rotation.x -= Math.PI * 0.3; // Tilt back (30-45 degrees up from floor?) 
            // Actually Plane is XY. lookAt(0,0,0) makes it face center. 
            // We want it lying flat then angled up.
            // Let's reset and do explicit rotation
            shard.rotation.set(0, -angle + Math.PI / 2, 0); // Face outward
            shard.rotation.x = -Math.PI / 4 - Math.random() * 0.2; // Tilt 45-60 deg up

            // Lift base slightly
            shard.position.y = h * 0.3;

            group.add(shard);
        }

        const material = new THREE.MeshPhysicalMaterial({
            color: 0xccEeff,              // Very pale blue-white
            emissive: 0x225588,           // Balanced blue glow
            emissiveIntensity: 0.6,       // Reduced glow for balance

            metalness: 0.0,               // Non-metallic for crystal
            roughness: 0.05,              // Very smooth like glass

            transmission: 0.4,            // Glass-like transparency (like geode)
            thickness: config.radius * 4, // Deep volume
            ior: 1.8,                     // Crystal-like refraction index

            clearcoat: 1.0,               // High polish
            clearcoatRoughness: 0.05,

            attenuationColor: new THREE.Color(0x88ddff), // Ice blue volume tint
            attenuationDistance: 1.5,

            envMapIntensity: 0.8,         // Strong environment reflections
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.9,
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.y = 0; // Sits perfectly on ground now
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);

        // Internal glow point light (balanced for crystal glow)
        const light = new THREE.PointLight(0x66ddff, 0.8, config.height * 2.5);
        light.position.y = config.height * 0.5;
        group.add(light);

        // Add subtle outer glow sprite
        const glowSprite = this.createPillarGlow(config);
        group.add(glowSprite);

        return { group, mesh, light, config, material };
    }

    createPillarGlow(config) {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        // Vertical gradient glow
        const gradient = ctx.createLinearGradient(64, 256, 64, 0);
        gradient.addColorStop(0, 'rgba(100, 200, 255, 0.0)');
        gradient.addColorStop(0.3, 'rgba(100, 200, 255, 0.3)');
        gradient.addColorStop(0.6, 'rgba(150, 220, 255, 0.2)');
        gradient.addColorStop(1, 'rgba(180, 240, 255, 0.0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 128, 256);

        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.scale.set(config.radius * 4, config.height * 1.1, 1);
        sprite.position.y = config.height * 0.5;

        return sprite;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SNOW PARTICLE SYSTEM
    // ═══════════════════════════════════════════════════════════════════════════

    createSnowSystem() {
        const snowCount = 3000;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(snowCount * 3);
        const randoms = new Float32Array(snowCount);
        const speeds = new Float32Array(snowCount);

        for (let i = 0; i < snowCount; i++) {
            const i3 = i * 3;
            positions[i3] = (Math.random() - 0.5) * 80;
            positions[i3 + 1] = Math.random() * 40;
            positions[i3 + 2] = (Math.random() - 0.5) * 60;

            randoms[i] = Math.random();
            speeds[i] = 0.5 + Math.random() * 1.0;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
        geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uSize: { value: 3.0 },
                uColor: { value: COLORS.snow },
            },
            vertexShader: snowVertexShader,
            fragmentShader: snowFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.snowSystem = new THREE.Points(geometry, material);
        this.mainGroup.add(this.snowSystem);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // LIGHTING
    // ═══════════════════════════════════════════════════════════════════════════

    setupLighting() {
        // Ambient light - cold blue tint
        const ambient = new THREE.AmbientLight(COLORS.ambient.getHex(), 0.4);
        this.scene.add(ambient);

        // Directional light from above (moonlight)
        const moonLight = new THREE.DirectionalLight(0x8899bb, 0.3);
        moonLight.position.set(10, 30, -20);
        this.scene.add(moonLight);

        // Hemisphere light for sky/ground color variation
        const hemiLight = new THREE.HemisphereLight(
            0x74b9ff,  // Sky (aurora tint)
            0x0a1f35,  // Ground (ice)
            0.4
        );
        this.scene.add(hemiLight);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ENVIRONMENT MAP - For realistic ice reflections/refractions
    // ═══════════════════════════════════════════════════════════════════════════

    createEnvironmentMap() {
        // Create a procedural environment map for reflections
        const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
        pmremGenerator.compileEquirectangularShader();

        // Create a simple gradient environment
        const envScene = new THREE.Scene();

        // Create gradient sky dome
        const skyGeometry = new THREE.SphereGeometry(50, 32, 32);
        const skyCanvas = document.createElement('canvas');
        skyCanvas.width = 512;
        skyCanvas.height = 256;
        const skyCtx = skyCanvas.getContext('2d');

        // Gradient from dark blue (bottom) to aurora colors (top)
        const gradient = skyCtx.createLinearGradient(0, 256, 0, 0);
        gradient.addColorStop(0, '#051525');    // Dark ice floor
        gradient.addColorStop(0.3, '#0a2a4a');  // Deep blue
        gradient.addColorStop(0.5, '#1a4466');  // Mid blue
        gradient.addColorStop(0.7, '#2a6688');  // Light blue
        gradient.addColorStop(0.85, '#55efc4'); // Aurora green
        gradient.addColorStop(1.0, '#74b9ff');  // Aurora cyan

        skyCtx.fillStyle = gradient;
        skyCtx.fillRect(0, 0, 512, 256);

        // Add chromatic glowing spots for crystal reflections (like geode theme)
        const spotColors = [
            '#74b9ff', '#55efc4', '#a29bfe', '#81ecec', // Aurora palette
            '#00cec9', '#6c5ce7', '#dfe6e9', '#b2bec3'  // Ice/crystal palette
        ];

        for (let i = 0; i < 60; i++) {
            const x = Math.random() * 512;
            const y = Math.random() * 200; // Upper 3/4 only
            const r = 2 + Math.random() * 12;
            const color = spotColors[Math.floor(Math.random() * spotColors.length)];

            const spotGrad = skyCtx.createRadialGradient(x, y, 0, x, y, r);
            spotGrad.addColorStop(0, color);
            spotGrad.addColorStop(0.5, color + '80');
            spotGrad.addColorStop(1, 'transparent');
            skyCtx.fillStyle = spotGrad;
            skyCtx.fillRect(x - r, y - r, r * 2, r * 2);
        }

        // Add bright stars/sparkles
        skyCtx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        for (let i = 0; i < 100; i++) {
            const x = Math.random() * 512;
            const y = Math.random() * 128; // Upper half only
            const size = Math.random() * 2 + 0.5;
            skyCtx.beginPath();
            skyCtx.arc(x, y, size, 0, Math.PI * 2);
            skyCtx.fill();
        }

        const skyTexture = new THREE.CanvasTexture(skyCanvas);
        const skyMaterial = new THREE.MeshBasicMaterial({
            map: skyTexture,
            side: THREE.BackSide,
        });

        const skyMesh = new THREE.Mesh(skyGeometry, skyMaterial);
        envScene.add(skyMesh);

        // Generate environment map
        const envMap = pmremGenerator.fromScene(envScene, 0.04).texture;
        this.scene.environment = envMap;

        // Apply to ice materials
        for (const pillar of this.icePillars) {
            if (pillar.material) {
                pillar.material.envMap = envMap;
                pillar.material.needsUpdate = true;
            }
        }

        // Apply to floor
        if (this.frostFloor && this.frostFloor.material) {
            this.frostFloor.material.envMap = envMap;
            this.frostFloor.material.needsUpdate = true;
        }

        // Cleanup
        pmremGenerator.dispose();
        skyMaterial.dispose();
        skyTexture.dispose();
        skyGeometry.dispose();

        this.environmentMap = envMap;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // GAMEPLAY EFFECTS
    // ═══════════════════════════════════════════════════════════════════════════

    setupEventListeners() {
        // Clean up existing listeners
        this.eventUnsubscribers.forEach(unsub => unsub?.());
        this.eventUnsubscribers = [];

        // Line Clear
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            if (this.isActive) this.onLineClear(data.lineCount || 1);
        });

        // Combo
        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            if (this.isActive) this.onCombo(data.comboCount || 0);
        });

        // Piece Lock
        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, (data) => {
            if (this.isActive) this.onPieceLock(data);
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
    }

    onLineClear(lineCount) {
        console.log(`[IceTemple] Line clear: ${lineCount}`);

        // Pulse ice pillars
        this.targetPulseIntensity = Math.min(lineCount * 0.5, 1.5);

        // Flash cracks
        this.targetCrackGlow = Math.min(0.5 + lineCount * 0.2, 1.0);

        // Create shockwave
        this.createShockwave(lineCount);

        // Create ice shard burst
        this.createIceShardBurst(lineCount * 15);
    }

    onCombo(comboCount) {
        if (comboCount < 2) return;

        console.log(`[IceTemple] Combo: ${comboCount}`);

        // Intensify aurora
        this.targetAuroraIntensity = Math.min(0.8 + comboCount * 0.15, 1.8);

        // Extended pillar pulse
        this.targetPulseIntensity = Math.min(comboCount * 0.3, 1.0);

        // Extra crack glow
        this.targetCrackGlow = Math.min(comboCount * 0.15, 0.8);

        // Multiple shockwaves for big combos
        if (comboCount >= 4) {
            this.createShockwave(comboCount);
        }
    }

    onPieceLock(data) {
        // Strong pillar pulse (impact feel)
        this.targetPulseIntensity = 3.0;

        // Shard burst from the base of EACH pillar
        for (const pillar of this.icePillars) {
            const pos = pillar.group.position;
            this.createIceShardBurst(5, pos.x, pos.z); // 5 shards per pillar
        }

        // Slight aurora disturbance
        this.targetAuroraIntensity = 1.0;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // EFFECT CREATION
    // ═══════════════════════════════════════════════════════════════════════════

    createShockwave(intensity) {
        const geometry = new THREE.TorusGeometry(2, 0.15, 8, 50);

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uOpacity: { value: 1.0 },
                uColor: { value: COLORS.iceGlow.clone() },
            },
            vertexShader: shockwaveVertexShader,
            fragmentShader: shockwaveFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            depthWrite: false,
        });

        const wave = new THREE.Mesh(geometry, material);
        wave.rotation.x = Math.PI / 2;
        wave.position.y = 0.5;

        wave.userData = {
            life: 1.0,
            speed: 8 + intensity * 2,
        };

        this.shockwaves.push(wave);
        this.mainGroup.add(wave);
    }

    createIceShardBurst(count, originX = 0, originZ = 0) {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const velocities = new Float32Array(count * 3);
        const lifes = new Float32Array(count);
        const randoms = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;

            // Start at the specified origin (pillar base)
            positions[i3] = originX + (Math.random() - 0.5) * 1.5;
            positions[i3 + 1] = 0.5 + Math.random() * 2;  // Start near ground
            positions[i3 + 2] = originZ + (Math.random() - 0.5) * 1.5;

            // Explosion velocity
            const angle = Math.random() * Math.PI * 2;
            const speed = 3 + Math.random() * 5;
            velocities[i3] = Math.cos(angle) * speed;
            velocities[i3 + 1] = 2 + Math.random() * 4;
            velocities[i3 + 2] = Math.sin(angle) * speed;

            lifes[i] = 1.0;
            randoms[i] = Math.random();
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aVelocity', new THREE.BufferAttribute(velocities, 3));
        geometry.setAttribute('aLife', new THREE.BufferAttribute(lifes, 1));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uSize: { value: 8.0 },
                uColor: { value: COLORS.iceShards },
            },
            vertexShader: iceShardVertexShader,
            fragmentShader: iceShardFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        const burst = new THREE.Points(geometry, material);
        burst.userData = {
            startTime: this.uniforms.time.value,
            duration: 1.5,
        };

        this.shardBursts.push(burst);
        this.mainGroup.add(burst);
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
        // SMOOTH TRANSITIONS
        // ─────────────────────────────────────────────────────────────────────

        // Decay pulse intensity
        this.uniforms.pulseIntensity.value = THREE.MathUtils.lerp(
            this.uniforms.pulseIntensity.value,
            this.targetPulseIntensity,
            delta * 3
        );
        this.targetPulseIntensity *= 0.95;

        // Decay crack glow
        this.uniforms.crackGlow.value = THREE.MathUtils.lerp(
            this.uniforms.crackGlow.value,
            this.targetCrackGlow,
            delta * 3
        );
        this.targetCrackGlow *= 0.97;

        // Aurora intensity
        this.uniforms.auroraIntensity.value = THREE.MathUtils.lerp(
            this.uniforms.auroraIntensity.value,
            this.targetAuroraIntensity,
            delta * 2
        );
        if (this.targetAuroraIntensity > 0.85) {
            this.targetAuroraIntensity -= delta * 0.2;
        }

        // ─────────────────────────────────────────────────────────────────────
        // CAMERA MOVEMENT (Continuous gentle orbit/sway)
        // ─────────────────────────────────────────────────────────────────────

        const camTime = elapsed * 0.15; // Smooth continuous movement
        const camRadius = 25;
        const camHeight = 8 + Math.sin(camTime * 0.5) * 2; // Gentle vertical bob

        this.camera.position.x = Math.sin(camTime) * 5;       // Side-to-side sway
        this.camera.position.y = camHeight;
        this.camera.position.z = camRadius + Math.cos(camTime * 0.3) * 3; // Slight forward/back
        this.camera.lookAt(0, 3, 0);  // Always look at center

        // ─────────────────────────────────────────────────────────────────────
        // MAIN GROUP DRIFT
        // ─────────────────────────────────────────────────────────────────────

        const driftTime = elapsed * 0.08;
        this.mainGroup.position.x = Math.sin(driftTime) * 1.5;
        this.mainGroup.position.y = Math.cos(driftTime * 0.7) * 0.5;
        this.mainGroup.rotation.y = Math.sin(driftTime * 0.5) * 0.02;

        // ─────────────────────────────────────────────────────────────────────
        // STAR FIELD ROTATION
        // ─────────────────────────────────────────────────────────────────────

        if (this.starField) {
            this.starField.rotation.y = elapsed * 0.005;
        }

        // Update aurora reflections
        if (this.auroraReflections) {
            for (const reflection of this.auroraReflections) {
                if (reflection.material.uniforms) {
                    reflection.material.uniforms.uTime.value = this.uniforms.time.value;
                    reflection.material.uniforms.uIntensity.value = this.uniforms.auroraIntensity.value * 0.6; // Slightly dimmer
                }
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // PILLAR LIGHT PULSING
        // ─────────────────────────────────────────────────────────────────────

        for (let i = 0; i < this.icePillars.length; i++) {
            const pillar = this.icePillars[i];
            const baseIntensity = 0.5;
            const pulse = Math.sin(elapsed * 1.5 + i * 0.8) * 0.2;
            pillar.light.intensity = baseIntensity + pulse + this.uniforms.pulseIntensity.value * 1.5;
        }

        // ─────────────────────────────────────────────────────────────────────
        // UPDATE SHOCKWAVES
        // ─────────────────────────────────────────────────────────────────────

        for (let i = this.shockwaves.length - 1; i >= 0; i--) {
            const wave = this.shockwaves[i];
            wave.userData.life -= delta * 0.8;

            wave.scale.addScalar(wave.userData.speed * delta);
            wave.material.uniforms.uOpacity.value = wave.userData.life;

            if (wave.userData.life <= 0) {
                this.mainGroup.remove(wave);
                wave.geometry.dispose();
                wave.material.dispose();
                this.shockwaves.splice(i, 1);
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // UPDATE SHARD BURSTS
        // ─────────────────────────────────────────────────────────────────────

        for (let i = this.shardBursts.length - 1; i >= 0; i--) {
            const burst = this.shardBursts[i];
            const age = this.uniforms.time.value - burst.userData.startTime;

            burst.material.uniforms.uTime.value = age;

            // Update life attribute
            const lifes = burst.geometry.attributes.aLife.array;
            let allDead = true;
            for (let j = 0; j < lifes.length; j++) {
                lifes[j] = Math.max(0, 1.0 - age / burst.userData.duration);
                if (lifes[j] > 0) allDead = false;
            }
            burst.geometry.attributes.aLife.needsUpdate = true;

            if (allDead || age > burst.userData.duration) {
                this.mainGroup.remove(burst);
                burst.geometry.dispose();
                burst.material.dispose();
                this.shardBursts.splice(i, 1);
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // RENDER
        // ─────────────────────────────────────────────────────────────────────

        // Use composer for bloom post-processing
        this.composer.render();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // WINDOW RESIZE
    // ═══════════════════════════════════════════════════════════════════════════

    onWindowResize() {
        if (!this.camera || !this.renderer) return;

        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);

        // Update composer size for bloom
        if (this.composer) {
            this.composer.setSize(window.innerWidth, window.innerHeight);
        }
        if (this.bloomPass) {
            this.bloomPass.resolution.set(window.innerWidth, window.innerHeight);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CLEANUP
    // ═══════════════════════════════════════════════════════════════════════════

    stop() {
        // Cancel animation frame
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }

        // Remove event listeners
        this.eventUnsubscribers.forEach(unsub => unsub?.());
        this.eventUnsubscribers = [];

        // Remove resize listener
        window.removeEventListener('resize', this.onWindowResize.bind(this));

        // Cleanup Three.js
        if (this.renderer) {
            this.renderer.dispose();
            const container = document.getElementById('ice-temple-theme');
            if (container && container.contains(this.renderer.domElement)) {
                container.removeChild(this.renderer.domElement);
            }
        }

        // Dispose scene objects
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

        // Clear arrays
        this.icePillars = [];
        this.auroraPlanes = [];
        this.shardBursts = [];
        this.shockwaves = [];

        // Null references
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.mainGroup = null;
        this.starField = null;
        this.snowSystem = null;
        this.frostFloor = null;

        super.stop();
    }
}
