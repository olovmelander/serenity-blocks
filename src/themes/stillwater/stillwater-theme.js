/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  🌲✨ STILLWATER THEME - A John Bauer Dreamscape ✨🌲
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * A realm between worlds - the enchanted twilight of Swedish folklore.
 * Where ancient forests hold secrets, spirits dwell in still waters,
 * and the boundary between magic and reality blurs.
 */

import * as THREE from 'three';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { STILLWATER_TETROMINOS } from './stillwater-tetrominos.js';
import {
    waterVertexShader,
    waterFragmentShader,
    treeVertexShader,
    treeFragmentShader,
    mossVertexShader,
    mossFragmentShader,
    spiritVertexShader,
    spiritFragmentShader,
    spiritLightVertexShader,
    spiritLightFragmentShader,
    fogVertexShader,
    fogFragmentShader,
    rippleVertexShader,
    rippleFragmentShader,
    lightBeamVertexShader,
    lightBeamFragmentShader,
    mushroomVertexShader,
    mushroomFragmentShader,
    auroraVertexShader,
    auroraFragmentShader,
    sporeVertexShader,
    sporeFragmentShader,
    lilyVertexShader,
    lilyFragmentShader,
    starsVertexShader,
    starsFragmentShader,
    trollVertexShader,
    trollFragmentShader,
    goldenMoteVertexShader,
    goldenMoteFragmentShader,
} from './stillwater-shaders.js';

// ═══════════════════════════════════════════════════════════════════════════
// MAGICAL COLOR PALETTE - Deep forest enchantment
// ═══════════════════════════════════════════════════════════════════════════

const COLORS = {
    // Water - deep mystical pool
    waterDeep: new THREE.Color(0x1a2a25),      // Deep forest green
    waterSurface: new THREE.Color(0x2a3a35),   // Murky green
    spiritReflection: new THREE.Color(0xf5e8c8), // Spirit's warm glow in water

    // Trees - ancient, alive
    treeBase: new THREE.Color(0x2a2520),       // Dark brown-grey
    treeMid: new THREE.Color(0x3a3530),        // Medium
    treeFar: new THREE.Color(0x4a4540),        // Faded into mist

    // Moss - rich forest floor
    mossDeep: new THREE.Color(0x1a2818),       // Deep forest green
    mossMid: new THREE.Color(0x2a3820),        // Rich moss
    mossLight: new THREE.Color(0x3a4830),      // Highlighted moss

    // Atmosphere
    fogColor: new THREE.Color(0x3a4035),       // Misty green-grey
    skyTop: new THREE.Color(0x1a2520),         // Dark night forest
    skyMid: new THREE.Color(0x2a3530),         // Twilight
    skyHorizon: new THREE.Color(0x4a5545),     // Distant glow

    // Spirit - luminous being
    spiritCore: new THREE.Color(0xfff8e8),     // Warm white
    spiritAura: new THREE.Color(0xf5e0b0),     // Golden glow

    // Magic particles
    lightWarm: new THREE.Color(0xfff5d0),      // Spirit spark
    lightCool: new THREE.Color(0xd0f0f5),      // Fairy light
    lightGold: new THREE.Color(0xffe8a0),      // Golden mote

    // Effects
    ripple: new THREE.Color(0x80a090),

    // Mushrooms - bioluminescent
    mushroomBase: new THREE.Color(0x4a3a30),     // Dark brown cap
    mushroomGlow: new THREE.Color(0x80f0c0),     // Cyan-green glow

    // Aurora - subtle northern lights
    auroraGreen: new THREE.Color(0x60f080),      // Aurora green
    auroraPurple: new THREE.Color(0xa080f0),     // Aurora purple

    // Lily pad
    lilyPad: new THREE.Color(0x2a4028),          // Deep green
    lilyFlower: new THREE.Color(0xfff0e0),       // Cream white

    // Trolls - glowing amber eyes
    trollEyes: new THREE.Color(0xffa040),        // Warm amber glow

    // Golden fireflies
    goldenMote: new THREE.Color(0xffc040),       // Warm gold
};

export default class StillwaterTheme extends BaseTheme {
    constructor() {
        super('stillwater');

        this.eventUnsubscribers = [];

        // Three.js core
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.mainGroup = null;
        this.clock = new THREE.Clock();
        this.animationFrame = null;

        // Scene elements
        this.water = null;
        this.trees = [];
        this.mossMounds = [];
        this.spirit = null;
        this.spiritLights = null;
        this.fogLayers = [];
        this.ripples = [];
        this.lightBeams = [];

        // New magical elements
        this.mushrooms = [];
        this.aurora = null;
        this.spores = null;
        this.lilies = [];
        this.trolls = [];
        this.canopyStars = null;
        this.canopyStars = null;
        this.goldenMotes = null;
        this.spiritBursts = [];

        // Uniforms
        this.uniforms = {
            time: { value: 0 },
            spiritGlow: { value: 1.0 },
            glowIntensity: { value: 0 },
        };

        // Animation targets
        this.targetSpiritGlow = 1.0;
        this.targetGlowIntensity = 0;

        // ═══════════════════════════════════════════════════════════════════════════
        // WANDERING SPIRIT SYSTEM
        // ═══════════════════════════════════════════════════════════════════════════
        this.spiritSpawnPoints = [
            { x: 0, y: 2.5, z: -6 },           // Center (original)
            { x: -25, y: 3.5, z: -8 },         // Left mid
            { x: 20, y: 2.0, z: -5 },          // Right mid
            { x: -40, y: 4.0, z: -10 },        // Far left (visiting far trolls)
            { x: 35, y: 3.0, z: -10 },         // Far right
            { x: 0, y: 5.0, z: -15 },          // Deep center, elevated
        ];
        this.currentSpiritIndex = 0;
        this.nextSpiritIndex = 0;
        this.spiritTransition = 1.0;          // 0 = invisible, 1 = fully visible
        this.spiritWanderTimer = 0;
        this.spiritWanderInterval = 12.0;     // Seconds between moves
        this.spiritState = 'visible';          // 'visible', 'fading_out', 'moving', 'fading_in'
        this.spiritCurrentPos = { x: 0, y: 2.5, z: -6 };

        // ═══════════════════════════════════════════════════════════════════════
        // TROLL ANIMATION DATA
        // ═══════════════════════════════════════════════════════════════════════
        this.trollAnimations = [];
    }

    getTetrominoConfig() {
        return STILLWATER_TETROMINOS;
    }

    async createScene() {
        console.log('[Stillwater] Creating magical realm...');

        const container = document.getElementById('stillwater-theme');
        if (!container) {
            console.error('[Stillwater] Container not found');
            return;
        }

        container.innerHTML = '';

        // ─────────────────────────────────────────────────────────────────────
        // SCENE
        // ─────────────────────────────────────────────────────────────────────

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(COLORS.fogColor.getHex(), 0.018);
        this.scene.background = this.createMagicalSky();

        // ─────────────────────────────────────────────────────────────────────
        // CAMERA - Looking into the forest pool
        // ─────────────────────────────────────────────────────────────────────

        this.camera = new THREE.PerspectiveCamera(
            45,
            window.innerWidth / window.innerHeight,
            0.1,
            200
        );
        this.camera.position.set(0, 6, 25); // Lower and further back
        this.camera.lookAt(0, 6, -15); // Look slightly up into the distance

        // ─────────────────────────────────────────────────────────────────────
        // RENDERER
        // ─────────────────────────────────────────────────────────────────────

        this.renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true,
            powerPreference: 'high-performance'
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        container.appendChild(this.renderer.domElement);

        // ─────────────────────────────────────────────────────────────────────
        // MAIN GROUP
        // ─────────────────────────────────────────────────────────────────────

        this.mainGroup = new THREE.Group();
        this.scene.add(this.mainGroup);

        // ─────────────────────────────────────────────────────────────────────
        // CREATE THE MAGICAL WORLD
        // ─────────────────────────────────────────────────────────────────────

        this.createEnchantedWater();
        this.createWaterLilies();
        this.createMossMounds();
        this.createGlowingMushrooms();
        this.createAncientTrees();
        this.createTheSpirit();
        this.createSpiritLights();
        this.createGoldenMotes();
        this.createFloatingSpores();
        this.createTrolls();
        this.createLightBeams();
        this.createMysticalFog();
        this.createCanopyStars();
        this.createForegroundFraming();
        this.createAuroraSky();
        this.setupEnchantedLighting();

        // ─────────────────────────────────────────────────────────────────────
        // EVENTS
        // ─────────────────────────────────────────────────────────────────────

        this.setupEventListeners();
        window.addEventListener('resize', this.onWindowResize.bind(this));

        this.animate();

        console.log('[Stillwater] Magical realm created.');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MAGICAL SKY - Deep twilight forest
    // ═══════════════════════════════════════════════════════════════════════════

    createMagicalSky() {
        const canvas = document.createElement('canvas');
        canvas.width = 2;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');

        const gradient = ctx.createLinearGradient(0, 0, 0, 512);
        gradient.addColorStop(0, '#1a2520');    // Deep forest darkness
        gradient.addColorStop(0.3, '#2a3530');  // Twilight green
        gradient.addColorStop(0.6, '#3a4540');  // Middle grey-green
        gradient.addColorStop(1, '#4a5545');    // Distant soft glow

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 2, 512);

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;

        return texture;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ENCHANTED WATER - Deep forest pool
    // ═══════════════════════════════════════════════════════════════════════════

    createEnchantedWater() {
        const geometry = new THREE.PlaneGeometry(80, 35, 48, 24);

        // Add uniforms for dynamic spirit position tracking
        this.uniforms.spiritPos = { value: new THREE.Vector3(0, 2.5, -6) };

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uSpiritGlow: this.uniforms.spiritGlow,
                uDeepColor: { value: COLORS.waterDeep },
                uSurfaceColor: { value: COLORS.waterSurface },
                uSpiritReflection: { value: COLORS.spiritReflection },
                uSpiritPos: this.uniforms.spiritPos,
                uSpiritTransition: { value: 1.0 },
            },
            vertexShader: waterVertexShader,
            fragmentShader: waterFragmentShader,
            transparent: true,
        });

        this.water = new THREE.Mesh(geometry, material);
        this.water.rotation.x = -Math.PI / 2;
        this.water.position.y = 0;
        this.water.position.z = 3;

        this.mainGroup.add(this.water);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MOSS MOUNDS - Organic rolling shapes
    // ═══════════════════════════════════════════════════════════════════════════

    createMossMounds() {
        // Create organic rolling moss mounds like in the painting
        const moundConfigs = [
            // Layer 1 - closest banks (Lower and wider)
            { y: -1.0, z: -2, scaleX: 18, scaleY: 2.5, scaleZ: 6, x: -28 }, // Left bank
            { y: -0.5, z: -3, scaleX: 20, scaleY: 3, scaleZ: 7, x: 28 },    // Right bank
            { y: -4.0, z: -6, scaleX: 30, scaleY: 2, scaleZ: 10, x: 0 },    // Sunken central ground (underwater/shore)

            // Layer 2 - middle undulating (Pushed back and flattened)
            { y: 0, z: -25, scaleX: 70, scaleY: 6, scaleZ: 15 },

            // Layer 3 - back rolling hills (Background)
            { y: 5, z: -40, scaleX: 90, scaleY: 10, scaleZ: 20 },
        ];

        for (const config of moundConfigs) {
            const geometry = new THREE.SphereGeometry(1, 32, 24);

            // Deform into organic mound shape
            const positions = geometry.attributes.position.array;
            for (let i = 0; i < positions.length; i += 3) {
                // Scale to mound shape
                positions[i] *= config.scaleX;
                positions[i + 1] *= config.scaleY;
                positions[i + 2] *= config.scaleZ;

                // Add organic noise
                const noise = Math.sin(positions[i] * 0.15) * 0.5 +
                    Math.cos(positions[i] * 0.08 + positions[i + 2] * 0.1) * 0.3;
                positions[i + 1] += noise * config.scaleY * 0.3;

                // Flatten bottom
                if (positions[i + 1] < 0) {
                    positions[i + 1] *= 0.2;
                }
            }
            geometry.computeVertexNormals();

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: this.uniforms.time,
                    uMossDeep: { value: COLORS.mossDeep },
                    uMossMid: { value: COLORS.mossMid },
                    uMossLight: { value: COLORS.mossLight },
                    uGlowIntensity: this.uniforms.glowIntensity,
                },
                vertexShader: mossVertexShader,
                fragmentShader: mossFragmentShader,
            });

            const mound = new THREE.Mesh(geometry, material);
            mound.position.set(config.x || 0, config.y, config.z);

            this.mossMounds.push(mound);
            this.mainGroup.add(mound);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ANCIENT TREES - Tall, organic, living
    // ═══════════════════════════════════════════════════════════════════════════

    createAncientTrees() {
        // Tree configurations - like pillars framing the scene
        const treeConfigs = [
            // Foreground frame trees
            { x: -18, z: -3, height: 55, radius: 1.8, color: COLORS.treeBase, depth: 0.0 },
            { x: 20, z: -4, height: 50, radius: 1.6, color: COLORS.treeBase, depth: 0.0 },

            // Close trees
            { x: -28, z: -8, height: 48, radius: 1.4, color: COLORS.treeBase, depth: 0.1 },
            { x: -10, z: -6, height: 52, radius: 1.5, color: COLORS.treeBase, depth: 0.05 },
            { x: 12, z: -7, height: 45, radius: 1.3, color: COLORS.treeBase, depth: 0.08 },
            { x: 30, z: -6, height: 50, radius: 1.5, color: COLORS.treeBase, depth: 0.05 },

            // Mid trees
            { x: -35, z: -15, height: 45, radius: 1.2, color: COLORS.treeMid, depth: 0.25 },
            { x: -22, z: -18, height: 42, radius: 1.1, color: COLORS.treeMid, depth: 0.3 },
            { x: -5, z: -16, height: 48, radius: 1.3, color: COLORS.treeMid, depth: 0.25 },
            { x: 8, z: -17, height: 44, radius: 1.2, color: COLORS.treeMid, depth: 0.28 },
            { x: 25, z: -15, height: 46, radius: 1.2, color: COLORS.treeMid, depth: 0.25 },
            { x: 38, z: -16, height: 43, radius: 1.1, color: COLORS.treeMid, depth: 0.3 },

            // Far trees (fading into mist)
            { x: -40, z: -28, height: 40, radius: 1.0, color: COLORS.treeFar, depth: 0.5 },
            { x: -28, z: -30, height: 38, radius: 0.9, color: COLORS.treeFar, depth: 0.55 },
            { x: -15, z: -32, height: 42, radius: 1.0, color: COLORS.treeFar, depth: 0.5 },
            { x: 0, z: -35, height: 40, radius: 0.9, color: COLORS.treeFar, depth: 0.55 },
            { x: 18, z: -30, height: 38, radius: 0.9, color: COLORS.treeFar, depth: 0.5 },
            { x: 32, z: -32, height: 42, radius: 1.0, color: COLORS.treeFar, depth: 0.52 },
            { x: 45, z: -28, height: 36, radius: 0.8, color: COLORS.treeFar, depth: 0.55 },
        ];

        for (const config of treeConfigs) {
            const tree = this.createTree(config);
            this.trees.push(tree);
            this.mainGroup.add(tree);
        }
    }

    createTree(config) {
        // Create organic tree trunk with slight bulges
        const geometry = new THREE.CylinderGeometry(
            config.radius * 0.4,   // Top (tapered)
            config.radius,         // Bottom
            config.height,
            12,
            8
        );

        // Add organic irregularity
        const positions = geometry.attributes.position.array;
        for (let i = 0; i < positions.length; i += 3) {
            const y = positions[i + 1];
            const heightRatio = (y + config.height / 2) / config.height;

            // Bulges at base and knots
            const bulge = Math.sin(heightRatio * Math.PI * 3) * 0.1 +
                Math.sin(heightRatio * Math.PI * 7) * 0.05;

            const currentRadius = Math.sqrt(positions[i] * positions[i] + positions[i + 2] * positions[i + 2]);
            const scale = 1 + bulge;

            positions[i] *= scale;
            positions[i + 2] *= scale;
        }
        geometry.computeVertexNormals();

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uTreeColor: { value: config.color },
                uFogColor: { value: COLORS.fogColor },
                uGlowIntensity: this.uniforms.glowIntensity,
                uGlowColor: { value: COLORS.spiritAura },
                uDepthLayer: { value: config.depth },
            },
            vertexShader: treeVertexShader,
            fragmentShader: treeFragmentShader,
        });

        const trunk = new THREE.Mesh(geometry, material);
        trunk.position.set(
            config.x + (Math.random() - 0.5) * 2,
            config.height / 2,
            config.z
        );

        return trunk;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // THE SPIRIT - Glowing ethereal Skogsrå
    // ═══════════════════════════════════════════════════════════════════════════

    createTheSpirit() {
        // Billboard plane for the spirit
        const geometry = new THREE.PlaneGeometry(10, 14);

        // Add uniform for transition opacity
        this.uniforms.spiritTransition = { value: 1.0 };

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uGlowIntensity: this.uniforms.spiritGlow,
                uTransition: this.uniforms.spiritTransition,
            },
            vertexShader: spiritVertexShader,
            fragmentShader: spiritFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        });

        this.spirit = new THREE.Mesh(geometry, material);

        // Start at first spawn point
        const startPos = this.spiritSpawnPoints[0];
        this.spirit.position.set(startPos.x, startPos.y, startPos.z);
        this.spiritCurrentPos = { ...startPos };

        this.mainGroup.add(this.spirit);

        // Add magical point light at spirit's heart
        const spiritLight = new THREE.PointLight(COLORS.spiritAura, 2.0, 25, 1.5);
        spiritLight.position.set(startPos.x, startPos.y + 1, startPos.z + 1);
        this.mainGroup.add(spiritLight);
        this.spiritLight = spiritLight;

        // Secondary softer glow
        const ambientGlow = new THREE.PointLight(COLORS.spiritCore, 0.5, 40, 2);
        ambientGlow.position.set(startPos.x, startPos.y + 1.5, startPos.z + 3);
        this.mainGroup.add(ambientGlow);
        this.spiritAmbient = ambientGlow;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SPIRIT LIGHTS - Magical floating particles
    // ═══════════════════════════════════════════════════════════════════════════

    createSpiritLights() {
        const count = 120;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const randoms = new Float32Array(count);
        const phases = new Float32Array(count);
        const colors = new Float32Array(count * 3);

        const colorOptions = [COLORS.lightWarm, COLORS.lightCool, COLORS.lightGold];

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;

            // Distribute throughout scene with more near spirit
            const isNearSpirit = Math.random() < 0.4;

            if (isNearSpirit) {
                // Cluster near spirit
                positions[i3] = (Math.random() - 0.5) * 25;
                positions[i3 + 1] = 3 + Math.random() * 12;
                positions[i3 + 2] = -2 - Math.random() * 12;
            } else {
                // Scatter throughout forest
                positions[i3] = (Math.random() - 0.5) * 60;
                positions[i3 + 1] = 2 + Math.random() * 18;
                positions[i3 + 2] = -5 - Math.random() * 30;
            }

            randoms[i] = Math.random();
            phases[i] = Math.random() * Math.PI * 2;

            // Random magical color
            const color = colorOptions[Math.floor(Math.random() * colorOptions.length)];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uSize: { value: 5.0 },
            },
            vertexShader: spiritLightVertexShader,
            fragmentShader: spiritLightFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.spiritLights = new THREE.Points(geometry, material);
        this.mainGroup.add(this.spiritLights);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MYSTICAL FOG
    // ═══════════════════════════════════════════════════════════════════════════

    createMysticalFog() {
        const fogConfigs = [
            { z: -8, height: 6, density: 0.25 },
            { z: -18, height: 10, density: 0.35 },
            { z: -30, height: 14, density: 0.45 },
        ];

        for (const config of fogConfigs) {
            const geometry = new THREE.PlaneGeometry(90, config.height);

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: this.uniforms.time,
                    uFogColor: { value: COLORS.fogColor },
                    uDensity: { value: config.density },
                },
                vertexShader: fogVertexShader,
                fragmentShader: fogFragmentShader,
                transparent: true,
                blending: THREE.NormalBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            });

            const fog = new THREE.Mesh(geometry, material);
            fog.position.set(0, config.height / 2 + 3, config.z);

            this.fogLayers.push(fog);
            this.mainGroup.add(fog);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // GLOWING MUSHROOMS - Bioluminescent forest floor
    // ═══════════════════════════════════════════════════════════════════════════

    createGlowingMushrooms() {
        const mushroomPositions = [
            { x: -12, z: -3, scale: 0.8 },
            { x: -8, z: -5, scale: 0.6 },
            { x: -5, z: -2, scale: 0.9 },
            { x: 6, z: -4, scale: 0.7 },
            { x: 10, z: -3, scale: 0.85 },
            { x: 15, z: -5, scale: 0.5 },
            { x: -18, z: -8, scale: 0.7 },
            { x: 20, z: -6, scale: 0.6 },
        ];

        for (const pos of mushroomPositions) {
            // Mushroom cap (hemisphere)
            const capGeometry = new THREE.SphereGeometry(0.5 * pos.scale, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2);

            const capMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: this.uniforms.time,
                    uMushroomColor: { value: COLORS.mushroomBase },
                    uGlowColor: { value: COLORS.mushroomGlow },
                    uGlowIntensity: { value: 1.0 },
                },
                vertexShader: mushroomVertexShader,
                fragmentShader: mushroomFragmentShader,
            });

            const cap = new THREE.Mesh(capGeometry, capMaterial);
            cap.position.set(pos.x, 0.4 * pos.scale, pos.z);

            // Stem (cylinder)
            const stemGeometry = new THREE.CylinderGeometry(0.1 * pos.scale, 0.15 * pos.scale, 0.4 * pos.scale, 8);
            const stemMaterial = new THREE.MeshBasicMaterial({ color: 0x8a7a70 });
            const stem = new THREE.Mesh(stemGeometry, stemMaterial);
            stem.position.set(pos.x, 0.2 * pos.scale, pos.z);

            // Point light for glow
            const glowLight = new THREE.PointLight(COLORS.mushroomGlow, 0.3, 4);
            glowLight.position.set(pos.x, 0.5 * pos.scale, pos.z);

            this.mushrooms.push({ cap, stem, light: glowLight });
            this.mainGroup.add(cap, stem, glowLight);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // AURORA SKY - Subtle northern lights whispers
    // ═══════════════════════════════════════════════════════════════════════════

    createAuroraSky() {
        const geometry = new THREE.PlaneGeometry(120, 30);

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uColor1: { value: COLORS.auroraGreen },
                uColor2: { value: COLORS.auroraPurple },
                uIntensity: { value: 0.6 },
            },
            vertexShader: auroraVertexShader,
            fragmentShader: auroraFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        });

        this.aurora = new THREE.Mesh(geometry, material);
        this.aurora.position.set(0, 35, -60);

        this.scene.add(this.aurora);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FLOATING SPORES - Dandelion seeds drifting through the scene
    // ═══════════════════════════════════════════════════════════════════════════

    createFloatingSpores() {
        const count = 80;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const randoms = new Float32Array(count);
        const phases = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;

            positions[i3] = (Math.random() - 0.5) * 60;
            positions[i3 + 1] = Math.random() * 20;
            positions[i3 + 2] = -5 - Math.random() * 35;

            randoms[i] = Math.random();
            phases[i] = Math.random() * Math.PI * 2;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uSize: { value: 3.0 },
            },
            vertexShader: sporeVertexShader,
            fragmentShader: sporeFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.spores = new THREE.Points(geometry, material);
        this.mainGroup.add(this.spores);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // WATER LILIES - Floating pads on the enchanted pool
    // ═══════════════════════════════════════════════════════════════════════════

    createWaterLilies() {
        const lilyPositions = [
            { x: -8, z: 5, scale: 1.0 },
            { x: -4, z: 8, scale: 0.8 },
            { x: 3, z: 6, scale: 0.9 },
            { x: 10, z: 7, scale: 0.7 },
            { x: -12, z: 9, scale: 0.6 },
        ];

        for (const pos of lilyPositions) {
            const geometry = new THREE.CircleGeometry(1.2 * pos.scale, 32);

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: this.uniforms.time,
                    uPadColor: { value: COLORS.lilyPad },
                    uFlowerColor: { value: COLORS.lilyFlower },
                    uGlowIntensity: this.uniforms.glowIntensity,
                },
                vertexShader: lilyVertexShader,
                fragmentShader: lilyFragmentShader,
                transparent: true,
                side: THREE.DoubleSide,
            });

            const lily = new THREE.Mesh(geometry, material);
            lily.rotation.x = -Math.PI / 2;
            lily.position.set(pos.x, 0.05, pos.z);

            this.lilies.push(lily);
            this.mainGroup.add(lily);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // TROLLS - Shadowy creatures with glowing eyes peeking from hiding
    // ═══════════════════════════════════════════════════════════════════════════

    createTrolls() {
        // Trolls positioned IN FRONT of the moss mound geometry to be visible
        // IMPORTANT: Moss mound Layer 2 is at z:-25 with scaleZ:15, so its front face is at z:-10
        // Moss mound Layer 3 is at z:-40 with scaleZ:20, so its front face is at z:-20
        // Trolls must be at z > -10 (in front of hill geometry) to be visible!
        // 
        // Tree z-positions for hiding: -3, -4, -6, -7, -8

        const trollPositions = [
            // Foreground trolls - hiding behind trees near the water (z: -3 to -8)
            { x: -35, z: -3, y: 0.5, scale: 0.9, hideX: -2.0, startPeeking: true },    // Far Left Foreground
            { x: 38, z: -4, y: 0.4, scale: 0.85, hideX: 2.0, startPeeking: false },    // Far Right Foreground
            { x: -16, z: -5, y: 0.5, scale: 0.8, hideX: -1.5, startPeeking: false },   // Mid Left

            // On the hill ridge - at the front edge of the moss mound (z: -8 to -10)
            // These appear to stand on the visible hill at various heights
            { x: -42, z: -8, y: 4.5, scale: 0.7, hideX: -1.5, startPeeking: true },    // Extreme Left Hill
            { x: 32, z: -9, y: 3.0, scale: 0.65, hideX: 1.5, startPeeking: false },    // Right side of hill
            { x: -5, z: -10, y: 4.0, scale: 0.6, hideX: -1.0, startPeeking: true },    // Center-left hill

            // Higher on the back hills - at z:-12 to -15, still in front of the geometry
            { x: -25, z: -12, y: 5.5, scale: 0.55, hideX: -1.2, startPeeking: true },  // Mid-Back Left
            { x: 42, z: -14, y: 6.0, scale: 0.5, hideX: 1.0, startPeeking: false },    // Extreme Right High
            { x: 0, z: -13, y: 5.8, scale: 0.5, hideX: 0.8, startPeeking: false },     // Center, on ridge
        ];

        for (let i = 0; i < trollPositions.length; i++) {
            const pos = trollPositions[i];
            const geometry = new THREE.PlaneGeometry(2.5 * pos.scale, 3.5 * pos.scale);

            // Some trolls start peeking - calculate initial peek for uniforms
            const willStartPeeking = pos.startPeeking || false;
            const peekInitial = willStartPeeking ? 0.4 + Math.random() * 0.3 : 0;

            // Each troll gets unique animation uniforms
            const trollUniforms = {
                uTime: this.uniforms.time,
                uGlowIntensity: this.uniforms.glowIntensity,
                uEyeColor: { value: COLORS.trollEyes },
                uSpiritPos: { value: new THREE.Vector3(0, 2.5, -6) },
                uPeekAmount: { value: peekInitial },
                uBreathScale: { value: 1.0 },
                uBlinkState: { value: 0.0 },
                // New uniforms support
                uEyeLook: { value: new THREE.Vector2(0, 0) },
                uExpression: { value: 0.0 },
                uSquish: { value: 1.0 },
            };

            const material = new THREE.ShaderMaterial({
                uniforms: trollUniforms,
                vertexShader: trollVertexShader,
                fragmentShader: trollFragmentShader,
                transparent: true,
                side: THREE.DoubleSide,
            });

            const troll = new THREE.Mesh(geometry, material);
            // Include pos.y to distribute trolls at different heights in 3D space
            const baseY = 1.5 * pos.scale + (pos.y || 0);

            // Apply initial position with peek offset (use peekInitial from above)
            const initialPeekOffset = -pos.hideX * peekInitial;
            troll.position.set(pos.x + initialPeekOffset, baseY, pos.z);

            // Store animation data for this troll - with natural behavior states

            this.trollAnimations.push({
                mesh: troll,
                uniforms: trollUniforms,
                baseX: pos.x,
                baseY: baseY,
                baseZ: pos.z,
                hideX: pos.hideX,
                scale: pos.scale,

                // Personality traits (fixed per troll)
                curiosity: 0.4 + Math.random() * 0.4,       // How bold this troll is
                nervousness: 0.2 + Math.random() * 0.5,     // How easily startled
                playfulness: Math.random(),                 // New: likeliness to hop/dance
                patience: 2 + Math.random() * 5,            // How long before changing behavior

                // Current behavior state
                behaviorState: willStartPeeking ? 'watching' : 'hiding',
                stateTimer: willStartPeeking ? 2 + Math.random() * 3 : Math.random() * 2,

                // Animation Targets
                targetPeek: peekInitial,
                currentPeek: peekInitial,

                // Look Direction
                lookTarget: new THREE.Vector2(0, 0),
                currentLook: new THREE.Vector2(0, 0),

                // Expression
                targetExpression: 0,
                currentExpression: 0,

                // Smooth animation values
                breathPhase: Math.random() * Math.PI * 2,
                headTilt: willStartPeeking ? (Math.random() - 0.5) * 0.1 : 0,
                targetHeadTilt: willStartPeeking ? (Math.random() - 0.5) * 0.1 : 0,
                bodyLean: willStartPeeking ? peekInitial * 0.05 : 0,

                // Physics Animation
                squish: 1.0,
                verticalVelocity: 0,
                hopPhase: 0,
                isHopping: false,
                shiverIntensity: 0,

                // Blinking
                blinkTimer: 2 + Math.random() * 4,
                blinkDuration: 0.12 + Math.random() * 0.08,
                isBlinking: false,

                // Spirit awareness
                lastSpiritDist: 100,
                wasStartled: false,
                animationPhase: 0,

                // Fidgeting
                fidgetTimer: Math.random() * 2,
                fidgetOffset: new THREE.Vector3(0, 0, 0),
                targetFidget: new THREE.Vector3(0, 0, 0),

                // Movement (Running/Hiding)
                currentOffset: 0,
            });

            this.trolls.push(troll);
            this.mainGroup.add(troll);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CANOPY STARS - Twinkling through gaps in the trees
    // ═══════════════════════════════════════════════════════════════════════════

    createCanopyStars() {
        const count = 100;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const randoms = new Float32Array(count);
        const brightness = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;

            // Stars in the upper sky, spread out
            positions[i3] = (Math.random() - 0.5) * 100;
            positions[i3 + 1] = 25 + Math.random() * 25;
            positions[i3 + 2] = -30 - Math.random() * 40;

            randoms[i] = Math.random();
            brightness[i] = 0.3 + Math.random() * 0.7;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
        geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uSize: { value: 3.0 },
            },
            vertexShader: starsVertexShader,
            fragmentShader: starsFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.canopyStars = new THREE.Points(geometry, material);
        this.scene.add(this.canopyStars);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // GOLDEN MOTES - Warm magical fireflies near the spirit
    // ═══════════════════════════════════════════════════════════════════════════

    createGoldenMotes() {
        const count = 50;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const randoms = new Float32Array(count);
        const phases = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;

            // Cluster around the spirit
            positions[i3] = (Math.random() - 0.5) * 15;
            positions[i3 + 1] = 3 + Math.random() * 10;
            positions[i3 + 2] = -3 - Math.random() * 8;

            randoms[i] = Math.random();
            phases[i] = Math.random() * Math.PI * 2;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uSize: { value: 8.0 },
            },
            vertexShader: goldenMoteVertexShader,
            fragmentShader: goldenMoteFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.goldenMotes = new THREE.Points(geometry, material);
        this.mainGroup.add(this.goldenMotes);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // GOD RAYS - Shafts of magical light
    // ═══════════════════════════════════════════════════════════════════════════

    createLightBeams() {
        const beamConfigs = [
            { x: -5, z: -10, w: 6, h: 40, rot: 0.2 },
            { x: 5, z: -15, w: 8, h: 50, rot: -0.15 },
            { x: -15, z: -8, w: 5, h: 35, rot: 0.1 },
            { x: 12, z: -20, w: 10, h: 45, rot: -0.25 },
        ];

        const geometry = new THREE.PlaneGeometry(1, 1);

        for (const config of beamConfigs) {
            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: this.uniforms.time,
                    uOpacity: { value: 0.4 },
                    uColor: { value: new THREE.Color(0xfff5d0) }, // Warm spirit light
                },
                vertexShader: lightBeamVertexShader,
                fragmentShader: lightBeamFragmentShader,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            });

            const beam = new THREE.Mesh(geometry, material);
            beam.position.set(config.x, 15, config.z);
            beam.scale.set(config.w, config.h, 1);
            beam.rotation.z = config.rot;
            beam.rotation.x = 0.1; // Tilt fitting perspective

            this.lightBeams.push(beam);
            this.mainGroup.add(beam);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FOREGROUND FRAMING - Repoussoir trees for depth
    // ═══════════════════════════════════════════════════════════════════════════

    createForegroundFraming() {
        // Large dark silhouette trees close to camera
        const positions = [
            { x: -18, z: 15, r: 2.5, h: 25 },
            { x: 22, z: 12, r: 3, h: 25 },
        ];

        const geometry = new THREE.CylinderGeometry(1, 1, 1, 16);

        for (const pos of positions) {
            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: this.uniforms.time,
                    uTreeColor: { value: new THREE.Color(0x110d0a) }, // Much darker
                    uFogColor: { value: COLORS.fogColor },
                    uGlowIntensity: this.uniforms.glowIntensity,
                    uGlowColor: { value: COLORS.spiritAura },
                    uDepthLayer: { value: 0.0 }, // No fog on foreground
                },
                vertexShader: treeVertexShader,
                fragmentShader: treeFragmentShader,
            });

            const tree = new THREE.Mesh(geometry, material);
            tree.position.set(pos.x, 5, pos.z);
            tree.scale.set(pos.r, pos.h, pos.r);

            // Add slight curve
            const positions = tree.geometry.attributes.position;
            const count = positions.count;
            for (let i = 0; i < count; i++) {
                const y = positions.getY(i);
                if (y > 0) {
                    positions.setX(i, positions.getX(i) + (Math.random() - 0.5) * 0.5);
                }
            }

            this.trees.push(tree);
            this.scene.add(tree); // Add to scene directly to avoid mainGroup rotation/fog issues if any
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ENCHANTED LIGHTING
    // ═══════════════════════════════════════════════════════════════════════════

    setupEnchantedLighting() {
        // 1. Moonlight (Cool, Blue) - From behind/left
        const moonLight = new THREE.DirectionalLight(0x405060, 0.4);
        moonLight.position.set(-10, 20, -10);
        this.scene.add(moonLight);

        // 2. Spirit/Heart of Forest (Warm, Gold) - Center/Right
        const sunLight = new THREE.DirectionalLight(0xffaa50, 0.6);
        sunLight.position.set(10, 15, -5);
        this.scene.add(sunLight);

        // 3. Deep Ambient (Dark Green/Blue)
        const ambient = new THREE.AmbientLight(0x0a1510, 0.6);
        this.scene.add(ambient);

        // 4. Rim Light for drama (Cyan)
        const rimLight = new THREE.SpotLight(0x40c0a0, 1.0);
        rimLight.position.set(0, 5, 20); // From camera?
        rimLight.lookAt(0, 0, -10);
        rimLight.distance = 50;
        rimLight.angle = 0.8;
        this.scene.add(rimLight);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // GAMEPLAY EFFECTS
    // ═══════════════════════════════════════════════════════════════════════════

    setupEventListeners() {
        this.eventUnsubscribers.forEach(unsub => unsub?.());
        this.eventUnsubscribers = [];

        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            if (this.isActive) this.onLineClear(data.lineCount || 1);
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            if (this.isActive) this.onCombo(data.comboCount || 0);
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, (data) => {
            if (this.isActive) this.onPieceLock(data);
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
    }

    onLineClear(lineCount) {
        console.log(`[Stillwater] Line clear: ${lineCount}`);

        // Spirit blazes brighter
        this.targetSpiritGlow = 1.0 + lineCount * 0.5;

        // Forest responds
        this.targetGlowIntensity = Math.min(lineCount * 0.35, 1.0);

        // Water ripples
        this.createRipple(lineCount * 0.4);

        // Light beams for big clears
        if (lineCount >= 3) {
            this.createLightBeam();
        }

        // TROLL REACTIONS
        for (const trollData of this.trollAnimations) {
            // Victory Jump for playful/curious trolls
            if ((trollData.playfulness > 0.6 || trollData.curiosity > 0.6) && trollData.behaviorState !== 'dozing') {
                trollData.behaviorState = 'victory';
                trollData.stateTimer = 2.0;

                if (trollData.isHopping) {
                    // Already in air? perform a smooth "air hop"
                    if (trollData.verticalVelocity < 0) {
                        // If falling, bounce back up
                        trollData.verticalVelocity = 7.0;
                    } else {
                        // If rising, boost slightly
                        trollData.verticalVelocity += 3.0;
                        // Cap max velocity so they don't fly away
                        if (trollData.verticalVelocity > 15.0) trollData.verticalVelocity = 15.0;
                    }
                } else {
                    // Fresh jump from ground
                    trollData.verticalVelocity = 8.0 + Math.random() * 4.0;
                    trollData.isHopping = true;
                }

                trollData.targetPeek = 0.8; // Pop up high
                trollData.targetExpression = 1.0;
            }
            // Nervous trolls might burrow deeper if it's too intense!
            else if (trollData.nervousness > 0.7 && lineCount >= 4) {
                trollData.behaviorState = 'burrowing';
                trollData.stateTimer = 3.0;
                trollData.targetPeek = 0.1; // Only eyes
                trollData.shiverIntensity = 1.0;
            }
        }
    }

    onCombo(comboCount) {
        if (comboCount < 2) return;

        console.log(`[Stillwater] Combo: ${comboCount}`);

        // Progressive magic intensification
        this.targetSpiritGlow = 1.0 + comboCount * 0.4;
        this.targetGlowIntensity = Math.min(comboCount * 0.3, 1.0);

        this.createRipple(comboCount * 0.3);

        if (comboCount >= 4) {
            this.createLightBeam();
        }
    }

    onPieceLock(data) {
        // Subtle spirit pulse
        this.targetSpiritGlow += 0.15;

        // Positioned visual effects
        if (data && data.piece) {
            // Map column 0-9 to roughly -12 to 12 world units
            // Board width is roughly 24 units in this scale
            const worldX = (data.piece.x - 4.5) * 2.6;

            // Z depth around water level (randomized slightly for depth)
            const worldZ = 3 + (Math.random() - 0.5) * 3;

            // Create ripple at specific location
            this.createRipple(0.5, worldX, worldZ);

            // Create particle burst
            this.createSpiritBurst(worldX, worldZ);
        }
    }

    createRipple(intensity, x, z) {
        const geometry = new THREE.PlaneGeometry(12, 12);

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uOpacity: { value: 0.5 },
                uColor: { value: COLORS.ripple },
                uRadius: { value: 0.1 },
            },
            vertexShader: rippleVertexShader,
            fragmentShader: rippleFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        const ripple = new THREE.Mesh(geometry, material);
        ripple.rotation.x = -Math.PI / 2;

        const posX = x !== undefined ? x : (Math.random() - 0.5) * 15;
        const posZ = z !== undefined ? z : 3 + (Math.random() - 0.5) * 10;

        ripple.position.set(posX, 0.1, posZ);

        ripple.userData = {
            life: 1.0,
            speed: 0.2 + intensity * 0.1,
            startTime: this.uniforms.time.value,
        };

        this.ripples.push(ripple);
        this.mainGroup.add(ripple);
    }

    createSpiritBurst(x, z) {
        const particleCount = 12;
        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const velocities = [];
        const phases = [];

        for (let i = 0; i < particleCount; i++) {
            // Start slightly above water
            positions.push(x + (Math.random() - 0.5), 0.5 + Math.random() * 1.0, z + (Math.random() - 0.5));

            // Upward and outward velocity
            const angle = Math.random() * Math.PI * 2;
            const speed = 1.0 + Math.random() * 2.0;
            const lift = 2.0 + Math.random() * 3.0;

            velocities.push(
                Math.cos(angle) * speed * 0.5, // X
                lift,                          // Y
                Math.sin(angle) * speed * 0.5  // Z
            );

            phases.push(Math.random() * Math.PI * 2);
        }

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

        // Use a simple textured material (or just circular points)
        // Reusing goldenMote colors but maybe slightly brighter/whiter for "impact"
        const material = new THREE.PointsMaterial({
            color: 0xfffcf0, // Bright white-gold
            size: 0.4,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        const burst = new THREE.Points(geometry, material);
        burst.userData = {
            velocities: velocities,
            life: 1.2,
            gravity: -3.0
        };

        this.spiritBursts.push(burst);
        this.mainGroup.add(burst);
    }

    createLightBeam() {
        const geometry = new THREE.PlaneGeometry(5, 22);

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uOpacity: { value: 1.0 },
                uColor: { value: COLORS.spiritAura },
            },
            vertexShader: lightBeamVertexShader,
            fragmentShader: lightBeamFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        const beam = new THREE.Mesh(geometry, material);
        beam.position.set(
            (Math.random() - 0.5) * 25,
            14,
            -10 - Math.random() * 15
        );
        beam.rotation.z = (Math.random() - 0.5) * 0.15;

        beam.userData = { life: 1.0 };

        this.lightBeams.push(beam);
        this.mainGroup.add(beam);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // WANDERING SPIRIT ANIMATION
    // ═══════════════════════════════════════════════════════════════════════════

    updateWanderingSpirit(delta) {
        if (!this.spirit) return;

        const fadeSpeed = 1.2;  // How fast spirit fades in/out

        switch (this.spiritState) {
            case 'visible':
                // Count down to next wander
                this.spiritWanderTimer += delta;
                if (this.spiritWanderTimer >= this.spiritWanderInterval) {
                    this.spiritWanderTimer = 0;
                    this.spiritState = 'fading_out';

                    // Pick next spawn point (different from current)
                    let nextIndex;
                    do {
                        nextIndex = Math.floor(Math.random() * this.spiritSpawnPoints.length);
                    } while (nextIndex === this.currentSpiritIndex && this.spiritSpawnPoints.length > 1);
                    this.nextSpiritIndex = nextIndex;
                }
                break;

            case 'fading_out':
                // Fade out the spirit
                this.spiritTransition -= delta * fadeSpeed;
                if (this.spiritTransition <= 0) {
                    this.spiritTransition = 0;
                    this.spiritState = 'moving';

                    // Move to new position instantly while invisible
                    const newPos = this.spiritSpawnPoints[this.nextSpiritIndex];
                    this.spirit.position.set(newPos.x, newPos.y, newPos.z);
                    this.spiritCurrentPos = { ...newPos };
                    this.currentSpiritIndex = this.nextSpiritIndex;

                    // Update lights position
                    if (this.spiritLight) {
                        this.spiritLight.position.set(newPos.x, newPos.y + 1, newPos.z + 1);
                    }
                    if (this.spiritAmbient) {
                        this.spiritAmbient.position.set(newPos.x, newPos.y + 1.5, newPos.z + 3);
                    }
                }
                break;

            case 'moving':
                // Brief pause while invisible, then fade in
                this.spiritWanderTimer += delta;
                if (this.spiritWanderTimer >= 0.5) {  // 0.5 second pause
                    this.spiritWanderTimer = 0;
                    this.spiritState = 'fading_in';
                }
                break;

            case 'fading_in':
                // Fade in at new position
                this.spiritTransition += delta * fadeSpeed;
                if (this.spiritTransition >= 1.0) {
                    this.spiritTransition = 1.0;
                    this.spiritState = 'visible';

                    // Randomize next interval slightly
                    this.spiritWanderInterval = 10.0 + Math.random() * 6.0;
                }
                break;
        }

        // Update spirit transition uniform
        if (this.uniforms.spiritTransition) {
            this.uniforms.spiritTransition.value = this.spiritTransition;
        }

        // Update spirit light intensity based on transition
        if (this.spiritLight) {
            const baseIntensity = 1.5 + (this.uniforms.spiritGlow.value - 1.0) * 2;
            this.spiritLight.intensity = baseIntensity * this.spiritTransition;
        }
        if (this.spiritAmbient) {
            this.spiritAmbient.intensity = 0.5 * this.spiritTransition;
        }

        // Update golden motes to follow spirit position
        if (this.goldenMotes && this.goldenMotes.position) {
            const targetX = this.spiritCurrentPos.x;
            const targetZ = this.spiritCurrentPos.z - 3;
            this.goldenMotes.position.x = THREE.MathUtils.lerp(this.goldenMotes.position.x, targetX, delta * 0.5);
            this.goldenMotes.position.z = THREE.MathUtils.lerp(this.goldenMotes.position.z, targetZ, delta * 0.5);
        }

        // Update water reflection uniforms (pass spirit position and transition to water shader)
        if (this.water && this.water.material.uniforms) {
            // Update spirit position for reflection
            if (this.uniforms.spiritPos) {
                this.uniforms.spiritPos.value.set(
                    this.spiritCurrentPos.x,
                    this.spiritCurrentPos.y,
                    this.spiritCurrentPos.z
                );
            }
            // Update transition for reflection fade
            if (this.water.material.uniforms.uSpiritTransition) {
                this.water.material.uniforms.uSpiritTransition.value = this.spiritTransition;
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // TROLL ANIMATIONS - Breathing, blinking, peeking, swaying
    // ═══════════════════════════════════════════════════════════════════════════

    updateTrollAnimations(delta) {
        for (const trollData of this.trollAnimations) {
            const { mesh, uniforms, baseX, baseY, baseZ, hideX, scale } = trollData;
            const { curiosity, nervousness, playfulness, patience } = trollData;

            // ─────────────────────────────────────────────────────────────────
            // SPIRIT AWARENESS
            // ─────────────────────────────────────────────────────────────────
            const spiritDist = Math.sqrt(
                Math.pow(this.spiritCurrentPos.x - baseX, 2) +
                Math.pow(this.spiritCurrentPos.z - baseZ, 2)
            );

            const spiritAppearedClose = trollData.lastSpiritDist > 25 && spiritDist < 15;
            const spiritVeryClose = spiritDist < 10;
            const spiritVisible = spiritDist < 60; // Increased range for wider map
            trollData.lastSpiritDist = spiritDist;

            // ─────────────────────────────────────────────────────────────────
            // BEHAVIOR STATE MACHINE
            // ─────────────────────────────────────────────────────────────────
            trollData.stateTimer -= delta;

            // Startle Reaction
            // Startle Reaction
            if (spiritAppearedClose && !trollData.wasStartled) {
                trollData.behaviorState = 'startled';
                trollData.wasStartled = true;

                // RUN AWAY! (If nervous and very close)
                if (nervousness > 0.6 && spiritVeryClose) {
                    trollData.behaviorState = 'fleeing';
                    trollData.stateTimer = 5.0; // Hide for a long time
                    trollData.targetPeek = 0.5; // Stay up while running
                    trollData.targetExpression = 1.0; // Panic!
                } else {
                    // Just duck
                    trollData.stateTimer = 0.5 + nervousness;
                    trollData.targetPeek = 0;
                    trollData.squish = 0.6;
                    trollData.targetExpression = 1.0;
                }
            }
            if (spiritDist > 30) trollData.wasStartled = false;

            // State Logic
            if (trollData.stateTimer <= 0) {
                switch (trollData.behaviorState) {
                    case 'hiding':
                        // DECISION: Peek, Doze, or Wait
                        const rand = Math.random();
                        if (rand < curiosity * 0.7) {
                            // PEEK
                            trollData.behaviorState = 'peeking';
                            trollData.targetPeek = 0.4 + Math.random() * 0.4;
                            trollData.stateTimer = 2.0 + Math.random() * 3.0;

                            // Sub-behavior: Playful Wiggle?
                            if (playfulness > 0.7 && !spiritVeryClose && Math.random() < 0.4) {
                                trollData.behaviorState = 'wiggling';
                                trollData.targetPeek = 0.6;
                                trollData.stateTimer = 1.5 + Math.random() * 1.5;
                                trollData.targetExpression = 0.5; // Happy eyes
                            }
                            // Sub-behavior: Nervous Sneak?
                            else if (nervousness > 0.6 && Math.random() < 0.5) {
                                trollData.behaviorState = 'sneaking';
                                trollData.targetPeek = 0.3;
                                trollData.stateTimer = 2.0 + Math.random() * 2.0;
                                trollData.targetExpression = -0.8; // Suspicious squint
                            }
                            else {
                                // Normal peek behavior
                                if (nervousness > 0.6) {
                                    trollData.shiverIntensity = 1.0;
                                    trollData.targetExpression = -0.5;
                                } else {
                                    trollData.targetExpression = 0.5;
                                }
                            }
                        } else if (rand > 0.9 && patience > 3.0 && !spiritVisible) {
                            // DOZE OFF (Rare, only if patient and safe)
                            trollData.behaviorState = 'dozing';
                            trollData.targetPeek = 0.15; // Barely visible
                            trollData.stateTimer = 5.0 + Math.random() * 10.0; // Sleep for a while
                            trollData.targetExpression = 0.0;
                            trollData.isBlinking = true; // Eyes closed
                        } else {
                            // WAIT
                            trollData.stateTimer = patience;
                        }
                        break;

                    case 'wiggling':
                        // Done wiggling, go to watching or hiding
                        trollData.behaviorState = 'watching';
                        trollData.stateTimer = 2.0;
                        trollData.targetPeek = 0.5;
                        break;

                    case 'sneaking':
                        // Done sneaking, retreat or watch
                        if (Math.random() < 0.5) {
                            trollData.behaviorState = 'retreating';
                            trollData.targetPeek = 0;
                            trollData.stateTimer = 1.0;
                        } else {
                            trollData.behaviorState = 'watching';
                            trollData.targetPeek = 0.4;
                            trollData.stateTimer = 2.0;
                        }
                        break;

                    case 'dozing':
                        // Wake up naturally
                        trollData.behaviorState = 'yawning';
                        trollData.animationPhase = 0;
                        trollData.stateTimer = 4.0;
                        trollData.targetPeek = 0.5;
                        trollData.isBlinking = true; // Eyes closed for yawn start
                        break;

                    case 'yawning':
                        // Transition to watching
                        trollData.behaviorState = 'watching';
                        trollData.stateTimer = 2.0;
                        trollData.targetPeek = 0.5;
                        trollData.targetExpression = 0.0;
                        break;

                    case 'sneezing':
                        // Transition to watching (embarrassed?)
                        trollData.behaviorState = 'watching';
                        trollData.stateTimer = 1.5;
                        trollData.targetPeek = 0.4;
                        trollData.targetExpression = -0.5; // Scrunchy face
                        break;

                        trollData.targetExpression = -0.5; // Scrunchy face
                        break;

                    case 'victory':
                    case 'chuckling':
                        trollData.behaviorState = 'watching';
                        trollData.stateTimer = 2.0;
                        trollData.targetPeek = 0.5;
                        break;

                    case 'burrowing':
                        // Peek back out cautiously
                        trollData.behaviorState = 'peeking';
                        trollData.targetPeek = 0.3;
                        trollData.stateTimer = 3.0;
                        break;

                    case 'confused':
                        // Back to normal
                        trollData.behaviorState = 'watching';
                        trollData.stateTimer = 2.0;
                        trollData.targetExpression = 0.0;
                        break;

                    case 'peeking':
                    case 'watching': // Unified for simplicity now
                        // Decide next move
                        if (spiritVeryClose || (Math.random() < nervousness * 0.3)) {
                            // Retreat!
                            trollData.behaviorState = 'retreating';
                            trollData.targetPeek = 0;
                            trollData.stateTimer = 1.0;
                            trollData.targetExpression = 0.0;
                        } else if (playfulness > 0.7 && Math.random() < 0.3) {
                            // Hop logic
                            trollData.isHopping = true;
                            trollData.verticalVelocity = 5.0 * scale;
                            trollData.stateTimer += 1.0;
                        } else if (playfulness > 0.6 && Math.random() < 0.2) {
                            // Random Chuckle
                            trollData.behaviorState = 'chuckling';
                            trollData.stateTimer = 1.0;
                            trollData.targetExpression = 0.5;
                        } else if (curiosity > 0.6 && Math.random() < 0.2) {
                            // CONFUSED? (Puppy head tilt)
                            trollData.behaviorState = 'confused';
                            trollData.stateTimer = 3.0;
                            trollData.animationPhase = 0;
                            trollData.targetExpression = 0.5;
                        }
                        // Chance to RETURN from hiding spot if safe
                        else if (Math.abs(trollData.currentOffset) > 0.1 && !spiritVisible && Math.random() < 0.2) {
                            trollData.behaviorState = 'returning';
                            trollData.targetPeek = 0.5;
                            trollData.stateTimer = 3.0; // Max time to return
                        }
                        else if (Math.random() < 0.05) { // Rare Sianeeze
                            // SNEEZING
                            trollData.behaviorState = 'sneezing';
                            trollData.stateTimer = 2.5;
                            trollData.animationPhase = 0;
                            trollData.targetPeek = 0.6;
                        } else if (curiosity > 0.6 && Math.random() < 0.3) {
                            // Start sneakily looking around
                            trollData.behaviorState = 'sneaking';
                            trollData.targetPeek = 0.4;
                            trollData.stateTimer = 2.5;
                        } else {
                            // Continue watching
                            trollData.targetPeek = 0.3 + Math.random() * 0.5;
                            trollData.stateTimer = 2.0;
                            if (spiritVisible) {
                                trollData.lookTarget.x = (this.spiritCurrentPos.x - baseX) * 0.1;
                                trollData.lookTarget.y = (this.spiritCurrentPos.y - baseY) * 0.1;
                            } else {
                                trollData.lookTarget.x = (Math.random() - 0.5) * 1.5;
                                trollData.lookTarget.y = (Math.random() - 0.5) * 1.0;
                            }
                        }
                        break;

                    case 'retreating':
                        trollData.behaviorState = 'hiding';
                        trollData.stateTimer = patience * 0.5;
                        trollData.shiverIntensity = 0;
                        trollData.targetExpression = 0;
                        break;

                    case 'startled':
                        trollData.behaviorState = 'hiding';
                        trollData.stateTimer = 1.0 + nervousness * 2.0;
                        break;
                }
            }

            // ─────────────────────────────────────────────────────────────────
            // STATE SPECIFIC LOGIC (Per Frame)
            // ─────────────────────────────────────────────────────────────────

            // WIGGLE LOGIC
            let wiggleOffset = 0;
            if (trollData.behaviorState === 'wiggling') {
                const wiggleSpeed = 15.0;
                wiggleOffset = Math.sin(this.uniforms.time.value * wiggleSpeed) * 0.1 * scale;
                trollData.headTilt = wiggleOffset * 1.5; // Head bobs with wiggle
                trollData.squish = 1.0 + Math.abs(Math.sin(this.uniforms.time.value * wiggleSpeed * 2.0)) * 0.1; // Bounce
            }

            // SNEAK LOGIC
            if (trollData.behaviorState === 'sneaking') {
                // Rapidly look side to side
                if (Math.random() < 0.1) {
                    trollData.lookTarget.x = (Math.random() - 0.5) * 2.0; // Dart eyes
                    trollData.targetHeadTilt = trollData.lookTarget.x * 0.2; // Head follows eyes
                }
                // Bob up and down slightly
                trollData.targetPeek = 0.3 + Math.sin(this.uniforms.time.value * 5.0) * 0.05;
            }

            // DOZING LOGIC
            if (trollData.behaviorState === 'dozing') {
                // Deep slow breathing
                trollData.breathPhase += delta * 0.5; // Slow down breath
                trollData.targetPeek = 0.15 + Math.sin(this.uniforms.time.value * 2.0) * 0.02; // Nodding off
                trollData.headTilt = 0.2; // Head hidden/down

                // Wake up if spirit moves nearby (simulated hearing/sensing)
                if (spiritDist < 25 && this.spiritState === 'moving') {
                    // WAKE UP!
                    trollData.behaviorState = 'startled';
                    trollData.isBlinking = false; // Open eyes wide
                    trollData.targetPeek = 0.8; // Pop up!
                    trollData.stateTimer = 1.0;
                    trollData.targetExpression = 1.0;
                } else {
                    trollData.isBlinking = true; // Force eyes closed
                }
            }


            // YAWNING LOGIC
            if (trollData.behaviorState === 'yawning') {
                const progress = 1.0 - (trollData.stateTimer / 4.0); // 0 to 1
                if (progress < 0.3) {
                    // Inhale / Stretch up
                    trollData.targetPeek = 0.6;
                    trollData.squish = 1.1 + progress * 0.5; // Stretch tall
                    trollData.headTilt = -0.2; // Head back
                    trollData.targetExpression = 0.5;
                } else if (progress < 0.7) {
                    // YAWN HOLD
                    trollData.isBlinking = false; // Eyes wide? Or squeezed shut?
                    trollData.targetExpression = 1.0; // Wide mouth
                    trollData.squish = 1.25 + Math.sin(progress * 10.0) * 0.02; // Quiver
                } else {
                    // Relax
                    trollData.targetPeek = 0.5;
                    trollData.squish = 1.0;
                    trollData.targetExpression = 0.0;
                    trollData.headTilt = 0;
                }
            }

            // SNEEZING LOGIC
            if (trollData.behaviorState === 'sneezing') {
                const t = 2.5 - trollData.stateTimer; // time elapsed
                if (t < 1.5) {
                    // Ah... ah... (Build up)
                    trollData.headTilt = -0.2 - (t * 0.1);
                    trollData.targetExpression = -0.5; // Scrunch
                    // Little pulses
                    trollData.squish = 1.0 + Math.sin(t * 10.0) * 0.05 * (t / 1.5);
                } else if (t < 1.6 && !trollData.isHopping) {
                    // CHOO! (Launch)
                    trollData.isHopping = true;
                    trollData.verticalVelocity = 6.0 * scale;
                    trollData.squish = 0.5; // Compression launch
                    trollData.headTilt = 0.4; // Head snap forward
                    trollData.targetExpression = -1.0; // Tight squeeze
                }
            }

            // CONFUSED LOGIC
            if (trollData.behaviorState === 'confused') {
                // Puppy head tilt loop
                const cycle = Math.sin(this.uniforms.time.value * 3.0);
                if (cycle > 0.5) trollData.targetHeadTilt = 0.3;
                else if (cycle < -0.5) trollData.targetHeadTilt = -0.3;

                trollData.targetExpression = 0.8; // Wide eyes
                trollData.lookTarget.copy(this.spiritCurrentPos).sub(new THREE.Vector3(baseX, 0, baseZ)).normalize().multiplyScalar(0.5);
            }

            // CHUCKLING LOGIC
            if (trollData.behaviorState === 'chuckling') {
                const chuckleSpeed = 30.0;
                // Vibrating height
                trollData.squish = 1.0 + Math.sin(this.uniforms.time.value * chuckleSpeed) * 0.05;
                trollData.headTilt = Math.sin(this.uniforms.time.value * chuckleSpeed * 0.5) * 0.05;
            }

            // BURROWING LOGIC
            if (trollData.behaviorState === 'burrowing') {
                // Shiver + Low
                trollData.squish = 0.7; // Flattened
                trollData.targetPeek = 0.1; // Force low
            }

            // VICTORY LOGIC
            if (trollData.behaviorState === 'victory') {
                // If on ground and not hopping, hop again! (Multiple jumps)
                if (!trollData.isHopping && trollData.stateTimer > 0.5) {
                    trollData.isHopping = true;
                    trollData.verticalVelocity = 6.0 * scale;
                    trollData.squish = 0.8; // Prepare
                }
            }

            // FLEEING LOGIC
            if (trollData.behaviorState === 'fleeing') {
                const speed = 8.0 * scale;
                const targetX = hideX * scale; // Adjust scale
                const dist = targetX - trollData.currentOffset;

                if (Math.abs(dist) > 0.1) {
                    trollData.currentOffset += Math.sign(dist) * speed * delta;
                    // Running bounce
                    trollData.squish = 0.9 + Math.abs(Math.sin(this.uniforms.time.value * 20.0)) * 0.2;
                    trollData.headTilt = 0.3 * Math.sign(dist); // Lean into run
                } else {
                    // Arrived!
                    trollData.currentOffset = targetX;
                    trollData.behaviorState = 'hiding';
                    trollData.stateTimer = 3.0 + nervousness * 5.0; // Hide!
                    trollData.targetPeek = 0.0; // Duck behind tree
                    trollData.squish = 0.7; // Catch breath
                }
            }

            // RETURNING LOGIC
            if (trollData.behaviorState === 'returning') {
                const speed = 4.0 * scale; // Slower sneak back
                const dist = 0 - trollData.currentOffset;

                if (Math.abs(dist) > 0.1) {
                    trollData.currentOffset += Math.sign(dist) * speed * delta;
                    // Sneaking bounce
                    trollData.squish = 0.95 + Math.abs(Math.sin(this.uniforms.time.value * 12.0)) * 0.1;
                    trollData.headTilt = 0.2 * Math.sign(dist);
                    trollData.lookTarget.x = Math.sign(dist); // Look where going
                } else {
                    // Back home
                    trollData.currentOffset = 0;
                    trollData.behaviorState = 'watching';
                    trollData.stateTimer = 1.0;
                }
            }


            // ─────────────────────────────────────────────────────────────────
            // PHYSICS & ANIMATION
            // ─────────────────────────────────────────────────────────────────

            // Apply Fidget Offset
            // ...

            // Apply Position (including movement offset)
            mesh.position.x = baseX + trollData.currentOffset;

            // Hopping Physics
            if (trollData.isHopping) {
                // Apply gravity
                trollData.verticalVelocity -= 25.0 * delta; // Gravity
                mesh.position.y += trollData.verticalVelocity * delta;

                // Ground collision
                if (mesh.position.y <= baseY) {
                    mesh.position.y = baseY;
                    trollData.isHopping = false;
                    trollData.verticalVelocity = 0;
                    // Landing squish
                    trollData.squish = 0.7;
                } else {
                    // Stretch while going up
                    trollData.squish = 1.0 + (trollData.verticalVelocity * 0.05);
                }
            } else {
                // Return to base Y (breathing handled separately)
                mesh.position.y = THREE.MathUtils.lerp(mesh.position.y, baseY, delta * 10.0);

                // Squish recovery (springy)
                trollData.squish = THREE.MathUtils.lerp(trollData.squish, 1.0, delta * 8.0);
            }

            // Shivering
            let shiverOffset = 0;
            if (trollData.shiverIntensity > 0) {
                trollData.shiverIntensity -= delta * 0.5; // Decay
                shiverOffset = Math.sin(this.uniforms.time.value * 30.0) * 0.05 * trollData.shiverIntensity;
            }

            // Smooth Peek Transition
            const peekSpeed = trollData.behaviorState === 'startled' ? 10.0 : 2.0;
            trollData.currentPeek = THREE.MathUtils.lerp(trollData.currentPeek, trollData.targetPeek, delta * peekSpeed);

            // Look Transition
            trollData.currentLook.lerp(trollData.lookTarget, delta * 3.0);
            // Clamp look
            trollData.currentLook.x = Math.max(-1.0, Math.min(1.0, trollData.currentLook.x));
            trollData.currentLook.y = Math.max(-1.0, Math.min(1.0, trollData.currentLook.y));

            // Expression Transition
            trollData.currentExpression = THREE.MathUtils.lerp(trollData.currentExpression, trollData.targetExpression, delta * 4.0);

            // Head Tilt Logic
            const tiltTarget = -trollData.currentLook.x * 0.1 + shiverOffset * 0.5;
            trollData.headTilt = THREE.MathUtils.lerp(trollData.headTilt, tiltTarget, delta * 3.0);

            // ─────────────────────────────────────────────────────────────────
            // TRANSFORM & UNIFORMS
            // ─────────────────────────────────────────────────────────────────

            // Breathing animation
            trollData.breathPhase = (trollData.breathPhase + delta * 0.8) % (Math.PI * 2);
            const breathAmount = Math.sin(trollData.breathPhase) * 0.05;

            // Fidgeting (subtle random movement)
            trollData.fidgetTimer -= delta;
            if (trollData.fidgetTimer <= 0) {
                trollData.fidgetTimer = 2.0 + Math.random() * 3.0;
                trollData.targetFidget.set((Math.random() - 0.5) * 0.05, (Math.random() - 0.5) * 0.05, 0);
            }
            trollData.fidgetOffset.lerp(trollData.targetFidget, delta * 2.0);

            // Position: base + peek offset + fidget + breathing
            const peekOffset = -hideX * trollData.currentPeek;
            // Add wiggle offset here
            let finalX = baseX + peekOffset + trollData.fidgetOffset.x + (trollData.behaviorState === 'wiggling' ? wiggleOffset : 0);

            mesh.position.x = finalX; // Use computed X including wiggle
            mesh.position.y = baseY + breathAmount + trollData.fidgetOffset.y;
            // Rotation
            trollData.bodyLean = trollData.currentPeek * 0.1 * Math.sign(-hideX); // Lean into peek
            mesh.rotation.z = trollData.bodyLean + trollData.headTilt;

            // Blinking Logic
            trollData.blinkTimer -= delta;
            if (trollData.blinkTimer <= 0 && !trollData.isBlinking) {
                trollData.isBlinking = true;
                trollData.blinkTimer = trollData.blinkDuration;
            } else if (trollData.isBlinking && trollData.blinkTimer <= 0) {
                trollData.isBlinking = false;
                trollData.blinkTimer = 2.0 + Math.random() * 4.0;
            }

            // Update Uniforms
            if (uniforms.uPeekAmount) uniforms.uPeekAmount.value = trollData.currentPeek;
            if (uniforms.uSquish) uniforms.uSquish.value = trollData.squish;
            if (uniforms.uExpression) uniforms.uExpression.value = trollData.currentExpression;
            if (uniforms.uEyeLook) uniforms.uEyeLook.value.copy(trollData.currentLook);
            if (uniforms.uBlinkState) uniforms.uBlinkState.value = trollData.isBlinking ? 1.0 : 0.0;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ANIMATION
    // ═══════════════════════════════════════════════════════════════════════════

    animate() {
        if (!this.isActive) return;

        this.animationFrame = requestAnimationFrame(this.animate.bind(this));

        const delta = this.clock.getDelta();
        const elapsed = this.clock.getElapsedTime();
        this.uniforms.time.value = elapsed;

        // ─────────────────────────────────────────────────────────────────────
        // SPIRIT GLOW TRANSITIONS
        // ─────────────────────────────────────────────────────────────────────

        this.uniforms.spiritGlow.value = THREE.MathUtils.lerp(
            this.uniforms.spiritGlow.value,
            this.targetSpiritGlow,
            delta * 4
        );
        if (this.targetSpiritGlow > 1.0) {
            this.targetSpiritGlow -= delta * 0.2;
        }

        // Spirit light intensity follows glow
        if (this.spiritLight) {
            this.spiritLight.intensity = 1.5 + (this.uniforms.spiritGlow.value - 1.0) * 2;
        }

        // ─────────────────────────────────────────────────────────────────────
        // FOREST GLOW
        // ─────────────────────────────────────────────────────────────────────

        this.uniforms.glowIntensity.value = THREE.MathUtils.lerp(
            this.uniforms.glowIntensity.value,
            this.targetGlowIntensity,
            delta * 3
        );
        this.targetGlowIntensity *= 0.95;

        // ─────────────────────────────────────────────────────────────────────
        // WANDERING SPIRIT
        // ─────────────────────────────────────────────────────────────────────

        this.updateWanderingSpirit(delta);

        // ─────────────────────────────────────────────────────────────────────
        // TROLL ANIMATIONS
        // ─────────────────────────────────────────────────────────────────────

        this.updateTrollAnimations(delta);

        // ─────────────────────────────────────────────────────────────────────
        // DREAMY DRIFT
        // ─────────────────────────────────────────────────────────────────────

        const driftTime = elapsed * 0.03;
        this.mainGroup.position.x = Math.sin(driftTime) * 0.6;
        this.mainGroup.position.y = Math.cos(driftTime * 0.7) * 0.15;
        this.mainGroup.rotation.y = Math.sin(driftTime * 0.5) * 0.008;

        // ─────────────────────────────────────────────────────────────────────
        // RIPPLES
        // ─────────────────────────────────────────────────────────────────────

        for (let i = this.ripples.length - 1; i >= 0; i--) {
            const ripple = this.ripples[i];
            const age = elapsed - ripple.userData.startTime;

            ripple.userData.life -= delta * 0.4;
            ripple.material.uniforms.uRadius.value = 0.1 + age * ripple.userData.speed;
            ripple.material.uniforms.uOpacity.value = ripple.userData.life;

            if (ripple.userData.life <= 0 || ripple.material.uniforms.uRadius.value > 1.0) {
                this.mainGroup.remove(ripple);
                ripple.geometry.dispose();
                ripple.material.dispose();
                this.ripples.splice(i, 1);
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // SPIRIT BURSTS
        // ─────────────────────────────────────────────────────────────────────

        for (let i = this.spiritBursts.length - 1; i >= 0; i--) {
            const burst = this.spiritBursts[i];
            burst.userData.life -= delta;

            // Quick fade out at end
            burst.material.opacity = Math.min(burst.userData.life, 1.0);

            if (burst.userData.life <= 0) {
                this.mainGroup.remove(burst);
                burst.geometry.dispose();
                burst.material.dispose();
                this.spiritBursts.splice(i, 1);
                continue;
            }

            const positions = burst.geometry.attributes.position.array;
            const velocities = burst.userData.velocities;
            const gravity = burst.userData.gravity;

            for (let j = 0; j < positions.length / 3; j++) {
                const idx = j * 3;

                // Apply velocity
                positions[idx] += velocities[idx] * delta;     // X
                positions[idx + 1] += velocities[idx + 1] * delta; // Y
                positions[idx + 2] += velocities[idx + 2] * delta; // Z

                // Apply gravity to Y velocity
                velocities[idx + 1] += gravity * delta;
            }

            burst.geometry.attributes.position.needsUpdate = true;
        }

        // ─────────────────────────────────────────────────────────────────────
        // LIGHT BEAMS
        // ─────────────────────────────────────────────────────────────────────

        for (let i = this.lightBeams.length - 1; i >= 0; i--) {
            const beam = this.lightBeams[i];
            beam.userData.life -= delta * 0.3;
            beam.material.uniforms.uOpacity.value = beam.userData.life;

            if (beam.userData.life <= 0) {
                this.mainGroup.remove(beam);
                beam.geometry.dispose();
                beam.material.dispose();
                this.lightBeams.splice(i, 1);
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // RENDER
        // ─────────────────────────────────────────────────────────────────────

        this.renderer.render(this.scene, this.camera);
    }

    onWindowResize() {
        if (!this.camera || !this.renderer) return;
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    stop() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }

        this.eventUnsubscribers.forEach(unsub => unsub?.());
        this.eventUnsubscribers = [];

        window.removeEventListener('resize', this.onWindowResize.bind(this));

        if (this.renderer) {
            this.renderer.dispose();
            const container = document.getElementById('stillwater-theme');
            if (container && this.renderer.domElement.parentNode === container) {
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

        this.trees = [];
        this.mossMounds = [];
        this.fogLayers = [];
        this.ripples = [];
        this.lightBeams = [];
        this.mushrooms = [];
        this.lilies = [];
        this.trolls = [];
        this.trollAnimations = [];

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.mainGroup = null;
        this.water = null;
        this.spirit = null;
        this.spiritLight = null;
        this.spiritAmbient = null;
        this.spiritLights = null;
        this.aurora = null;
        this.spores = null;
        this.canopyStars = null;
        this.goldenMotes = null;

        super.stop();
    }
}
