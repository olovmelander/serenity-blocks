import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { ASTRAL_WEAVE_TETROMINOS } from './astral-weave-tetrominos.js';
import {
    cosmicThreadVertexShader,
    cosmicThreadFragmentShader,
    starVertexShader,
    starFragmentShader,
    nebulaVertexShader,
    nebulaFragmentShader,
    stardustVertexShader,
    stardustFragmentShader,
    pulseWaveVertexShader,
    pulseWaveFragmentShader,
    warpVortexVertexShader,
    warpVortexFragmentShader,
    cosmicOrbVertexShader,
    cosmicOrbFragmentShader,
    shootingStarVertexShader,
    shootingStarFragmentShader
} from './astral-weave-shaders.js';

/**
 * Astral Weave Theme - Three.js 3D Edition
 *
 * A breathtaking visualization of cosmic threads weaving through deep space.
 * Features:
 * - 3D cosmic weave ribbons with flowing animation
 * - Deep space starfield with twinkling stars
 * - Volumetric nebula clouds
 * - Energy pulses and cosmic orbs on events
 * - Warp vortex effects on big combos
 * - Dynamic camera drift for immersive depth
 */
export default class AstralWeaveTheme extends BaseTheme {
    constructor() {
        super('astral-weave');

        this.tetrominoConfig = ASTRAL_WEAVE_TETROMINOS;

        // Three.js components
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.composer = null;
        this.mainGroup = null;

        // Visual elements
        this.cosmicThreads = [];
        this.starSystem = null;
        this.nebulaParticles = null;
        this.stardustSystem = null;
        this.pulseWaves = [];
        this.cosmicOrbs = null;
        this.warpVortexes = [];
        this.shootingStars = [];
        this.constellations = [];

        // Animation
        this.animationFrame = null;
        this.clock = new THREE.Clock();

        // Uniforms
        this.uniforms = {
            time: { value: 0 },
            intensity: { value: 1.0 }
        };

        // State
        this.comboIntensity = 0;

        // Color palette - Cosmic ethereal colors
        this.colorPalette = {
            cyan: new THREE.Color(0x00ffff),
            magenta: new THREE.Color(0xff00ff),
            gold: new THREE.Color(0xffd700),
            purple: new THREE.Color(0x7c4dff),
            green: new THREE.Color(0x00ff88),
            white: new THREE.Color(0xffffff)
        };

        // Quality presets
        this.qualityPresets = {
            Minimal: {
                threadCount: 4,
                starCount: 600,
                nebulaCount: 40,
                stardustCount: 80,
                bloomEnabled: false,
                bloomStrength: 0.3,
                bloomRadius: 0.2
            },
            Low: {
                threadCount: 6,
                starCount: 1000,
                nebulaCount: 60,
                stardustCount: 120,
                bloomEnabled: false,
                bloomStrength: 0.35,
                bloomRadius: 0.25
            },
            Medium: {
                threadCount: 8,
                starCount: 1500,
                nebulaCount: 100,
                stardustCount: 180,
                bloomEnabled: true,
                bloomStrength: 0.4,
                bloomRadius: 0.3
            },
            High: {
                threadCount: 10,
                starCount: 2200,
                nebulaCount: 150,
                stardustCount: 250,
                bloomEnabled: true,
                bloomStrength: 0.45,
                bloomRadius: 0.35
            },
            Ultra: {
                threadCount: 12,
                starCount: 3000,
                nebulaCount: 200,
                stardustCount: 350,
                bloomEnabled: true,
                bloomStrength: 0.5,
                bloomRadius: 0.4
            },
            Extreme: {
                threadCount: 15,
                starCount: 4000,
                nebulaCount: 280,
                stardustCount: 500,
                bloomEnabled: true,
                bloomStrength: 0.55,
                bloomRadius: 0.45
            }
        };
        this.currentQuality = 'High';
        this.activePreset = this.qualityPresets.High;

        // Event handling
        this.eventUnsubscribers = [];
    }

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    async createScene() {
        console.log('[AstralWeave3D] Initializing Three.js scene...');

        // Create container if it doesn't exist
        let container = document.getElementById('astral-weave-theme');
        if (!container) {
            container = document.createElement('div');
            container.id = 'astral-weave-theme';
            container.className = 'theme-container';
            Object.assign(container.style, {
                position: 'fixed',
                top: '0',
                left: '0',
                width: '100%',
                height: '100%',
                zIndex: '-1',
                pointerEvents: 'none',
                opacity: '0',
                transition: 'opacity 0.5s ease-in-out',
            });
            document.body.appendChild(container);
            this.registerContainer(container);

            // Trigger reflow and fade in
            container.offsetHeight;
            container.classList.add('active');
            container.style.opacity = '1';
        } else {
            container.innerHTML = '';
        }

        this.currentQuality = this.getGraphicsQuality();
        this.activePreset = this.qualityPresets[this.currentQuality] || this.qualityPresets.High;

        // Setup Scene
        this.scene = new THREE.Scene();
        // Deep cosmic purple-indigo background
        this.scene.background = new THREE.Color(0x050010);
        this.scene.fog = new THREE.FogExp2(0x080018, 0.006);

        // Setup Camera
        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        this.camera.position.set(0, 0, 30);
        this.camera.lookAt(0, 0, 0);

        // Setup Renderer
        this.renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true,
            powerPreference: 'high-performance'
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        container.appendChild(this.renderer.domElement);

        // Create main group for drifting
        this.mainGroup = new THREE.Group();
        this.scene.add(this.mainGroup);

        // Create all elements
        this.createStarField();
        this.createCosmicThreads();
        this.createNebulaParticles();
        this.createStardust();
        this.createCosmicOrbsPool();
        this.setupLighting();
        this.setupPostProcessing();

        // Event listeners
        this.setupEventListeners();
        window.addEventListener('resize', this.onWindowResize.bind(this));

        // Start animation
        this.animate();

        console.log(`[AstralWeave3D] Scene initialized with ${this.currentQuality} quality.`);
    }

    createStarField() {
        const count = this.activePreset.starCount;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const phases = new Float32Array(count);
        const colors = new Float32Array(count * 3);

        // Star color palette
        const starColors = [
            new THREE.Color(0xffffff), // White
            new THREE.Color(0xe0f0ff), // Pale blue
            new THREE.Color(0xffd0e0), // Pink tint
            new THREE.Color(0xd0e8ff), // Cyan tint
            new THREE.Color(0xffffee), // Warm white
            new THREE.Color(0xccffee)  // Green tint
        ];

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;

            // Spread stars in a large sphere around camera
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const radius = 50 + Math.random() * 100;

            positions[i3] = Math.sin(phi) * Math.cos(theta) * radius;
            positions[i3 + 1] = Math.sin(phi) * Math.sin(theta) * radius;
            positions[i3 + 2] = Math.cos(phi) * radius;

            sizes[i] = Math.random() * 2.5 + 0.5;
            phases[i] = Math.random() * Math.PI * 2;

            const color = starColors[Math.floor(Math.random() * starColors.length)];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: this.uniforms.time
            },
            vertexShader: starVertexShader,
            fragmentShader: starFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });

        this.starSystem = new THREE.Points(geometry, material);
        this.scene.add(this.starSystem);
    }

    createCosmicThreads() {
        const threadCount = this.activePreset.threadCount;

        // Thread color sets - ethereal cosmic colors
        const threadColorSets = [
            { primary: this.colorPalette.cyan, secondary: this.colorPalette.magenta, tertiary: this.colorPalette.gold },
            { primary: this.colorPalette.magenta, secondary: this.colorPalette.purple, tertiary: this.colorPalette.cyan },
            { primary: this.colorPalette.purple, secondary: this.colorPalette.cyan, tertiary: this.colorPalette.green },
            { primary: this.colorPalette.gold, secondary: this.colorPalette.cyan, tertiary: this.colorPalette.magenta },
            { primary: this.colorPalette.green, secondary: this.colorPalette.gold, tertiary: this.colorPalette.purple }
        ];

        for (let i = 0; i < threadCount; i++) {
            const colorSet = threadColorSets[i % threadColorSets.length];

            // Create smooth, elegant sine wave path for the thread
            const points = [];
            const numPoints = 80;

            // Spread threads vertically across screen
            const baseY = ((i / threadCount) - 0.5) * 35;
            const baseZ = -15 + (i % 3) * 5; // Layer threads at different depths

            // Each thread has unique wave properties for organic variation
            const amplitude = 6 + (i % 4) * 2; // Wave height
            const frequency = 1.5 + (i % 3) * 0.5; // Wave frequency
            const phaseOffset = (i / threadCount) * Math.PI * 2; // Phase offset

            for (let j = 0; j < numPoints; j++) {
                const t = j / (numPoints - 1);
                const x = -50 + t * 100; // Span from -50 to +50

                // Smooth sine wave with secondary harmonic for organic feel
                const y = baseY +
                    Math.sin(t * Math.PI * frequency + phaseOffset) * amplitude +
                    Math.sin(t * Math.PI * frequency * 2 + phaseOffset * 1.5) * (amplitude * 0.3);

                // Gentle Z undulation for depth
                const z = baseZ + Math.cos(t * Math.PI * frequency * 0.7 + phaseOffset) * 3;

                points.push(new THREE.Vector3(x, y, z));
            }

            const curve = new THREE.CatmullRomCurve3(points);

            // Create thin, elegant tube geometry
            const tubeGeometry = new THREE.TubeGeometry(curve, 64, 0.08, 6, false);

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    time: this.uniforms.time,
                    intensity: this.uniforms.intensity,
                    waveSpeed: { value: 0.2 + (i % 5) * 0.05 },
                    waveAmplitude: { value: 1.0 },
                    threadOffset: { value: i * 1.5 },
                    colorPrimary: { value: colorSet.primary },
                    colorSecondary: { value: colorSet.secondary },
                    colorTertiary: { value: colorSet.tertiary }
                },
                vertexShader: cosmicThreadVertexShader,
                fragmentShader: cosmicThreadFragmentShader,
                transparent: true,
                depthWrite: false,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending
            });

            const thread = new THREE.Mesh(tubeGeometry, material);
            thread.userData.baseY = baseY;
            thread.userData.phaseOffset = phaseOffset;

            this.mainGroup.add(thread);
            this.cosmicThreads.push(thread);
        }
    }

    createNebulaParticles() {
        const count = this.activePreset.nebulaCount;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const randoms = new Float32Array(count);
        const colors = new Float32Array(count * 3);

        // Nebula colors - deep purples, cyans, magentas
        const nebulaColors = [
            new THREE.Color(0x4a0080), // Deep purple
            new THREE.Color(0x0060a0), // Deep blue
            new THREE.Color(0x800060), // Deep magenta
            new THREE.Color(0x005858), // Deep teal
            new THREE.Color(0x3a1480)  // Violet
        ];

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;

            // Spread around the scene
            positions[i3] = (Math.random() - 0.5) * 100;
            positions[i3 + 1] = (Math.random() - 0.5) * 60;
            positions[i3 + 2] = (Math.random() - 0.5) * 80 - 20;

            randoms[i] = Math.random();

            const color = nebulaColors[Math.floor(Math.random() * nebulaColors.length)];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: this.uniforms.time
            },
            vertexShader: nebulaVertexShader,
            fragmentShader: nebulaFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });

        this.nebulaParticles = new THREE.Points(geometry, material);
        this.mainGroup.add(this.nebulaParticles);
    }

    createStardust() {
        const count = this.activePreset.stardustCount;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const phases = new Float32Array(count);
        const sizes = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;

            positions[i3] = (Math.random() - 0.5) * 80;
            positions[i3 + 1] = (Math.random() - 0.5) * 50;
            positions[i3 + 2] = (Math.random() - 0.5) * 60 - 10;

            phases[i] = Math.random() * Math.PI * 2;
            sizes[i] = Math.random() * 2 + 0.5;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: this.uniforms.time
            },
            vertexShader: stardustVertexShader,
            fragmentShader: stardustFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });

        this.stardustSystem = new THREE.Points(geometry, material);
        this.mainGroup.add(this.stardustSystem);
    }

    createCosmicOrbsPool() {
        // Create a pool of cosmic orbs for event effects
        const maxOrbs = 20;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(maxOrbs * 3);
        const phases = new Float32Array(maxOrbs);
        const sizes = new Float32Array(maxOrbs);
        const colors = new Float32Array(maxOrbs * 3);

        for (let i = 0; i < maxOrbs; i++) {
            positions[i * 3] = 0;
            positions[i * 3 + 1] = -1000; // Hidden initially
            positions[i * 3 + 2] = 0;
            phases[i] = Math.random() * Math.PI * 2;
            sizes[i] = 0;
            colors[i * 3] = 0;
            colors[i * 3 + 1] = 1;
            colors[i * 3 + 2] = 1;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: this.uniforms.time
            },
            vertexShader: cosmicOrbVertexShader,
            fragmentShader: cosmicOrbFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });

        this.cosmicOrbs = new THREE.Points(geometry, material);
        this.cosmicOrbs.userData.activeOrbs = [];
        this.mainGroup.add(this.cosmicOrbs);
    }

    setupLighting() {
        // Ambient light - deep space blue
        const ambient = new THREE.AmbientLight(0x1a1a40, 0.4);
        this.scene.add(ambient);

        // Cyan cosmic light
        const cyanLight = new THREE.PointLight(0x00ffff, 1.2, 80);
        cyanLight.position.set(20, 15, 10);
        this.mainGroup.add(cyanLight);

        // Magenta cosmic light
        const magentaLight = new THREE.PointLight(0xff00ff, 1.0, 70);
        magentaLight.position.set(-20, -10, 5);
        this.mainGroup.add(magentaLight);

        // Gold accent light
        const goldLight = new THREE.PointLight(0xffd700, 0.8, 50);
        goldLight.position.set(0, 20, -15);
        this.mainGroup.add(goldLight);
    }

    setupPostProcessing() {
        if (!this.activePreset.bloomEnabled) {
            this.composer = null;
            return;
        }

        const width = window.innerWidth;
        const height = window.innerHeight;

        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(width, height),
            this.activePreset.bloomStrength,
            this.activePreset.bloomRadius,
            0.7
        );
        this.composer.addPass(this.bloomPass);
    }

    setupEventListeners() {
        // Line Clear - energy pulses
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (!this.isActive || settings?.backgroundComboEffects === false) return;

            this.uniforms.intensity.value += data.lineCount * 0.3;
            this.comboIntensity += data.lineCount * 0.25;

            // Create pulse waves
            this.createPulseWave(data.lineCount);

            // Spawn cosmic orbs
            if (data.lineCount >= 2) {
                this.spawnCosmicOrbs(data.lineCount * 2);
            }

            // Create warp vortex for big clears
            if (data.lineCount >= 3) {
                this.createWarpVortex();
            }
        });

        // Combo - shooting stars
        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (!this.isActive || settings?.backgroundComboEffects === false) return;

            this.uniforms.intensity.value += 0.2;
            this.comboIntensity += data.comboCount * 0.12;

            if (data.comboCount >= 2) {
                this.createShootingStar();
            }
            if (data.comboCount >= 4) {
                this.createShootingStar();
            }
            if (data.comboCount >= 6) {
                this.createWarpVortex();
            }
        });

        // Piece Lock - subtle intensity boost
        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (!this.isActive || settings?.backgroundComboEffects === false) return;

            this.uniforms.intensity.value += 0.08;
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
    }

    createPulseWave(intensity) {
        const geometry = new THREE.TorusGeometry(3, 0.2, 8, 48);

        const colors = [this.colorPalette.cyan, this.colorPalette.magenta, this.colorPalette.gold];
        const color = colors[Math.floor(Math.random() * colors.length)];

        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: this.uniforms.time,
                opacity: { value: 0.9 },
                color: { value: color }
            },
            vertexShader: pulseWaveVertexShader,
            fragmentShader: pulseWaveFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            depthWrite: false
        });

        const wave = new THREE.Mesh(geometry, material);
        wave.position.set(
            (Math.random() - 0.5) * 30,
            (Math.random() - 0.5) * 20,
            (Math.random() - 0.5) * 10
        );
        wave.rotation.set(
            Math.random() * Math.PI,
            Math.random() * Math.PI,
            0
        );

        wave.userData = {
            speed: 8 + intensity * 2,
            life: 1.5,
            maxLife: 1.5
        };

        this.mainGroup.add(wave);
        this.pulseWaves.push(wave);
    }

    spawnCosmicOrbs(count) {
        if (!this.cosmicOrbs) return;

        const positions = this.cosmicOrbs.geometry.attributes.position.array;
        const sizes = this.cosmicOrbs.geometry.attributes.aSize.array;
        const colors = this.cosmicOrbs.geometry.attributes.aColor.array;
        const activeOrbs = this.cosmicOrbs.userData.activeOrbs;

        const orbColors = [
            this.colorPalette.cyan,
            this.colorPalette.magenta,
            this.colorPalette.gold,
            this.colorPalette.green
        ];

        for (let i = 0; i < Math.min(count, 20); i++) {
            const orbIndex = activeOrbs.length < 20 ? activeOrbs.length : Math.floor(Math.random() * 20);
            const i3 = orbIndex * 3;

            positions[i3] = (Math.random() - 0.5) * 40;
            positions[i3 + 1] = (Math.random() - 0.5) * 30;
            positions[i3 + 2] = (Math.random() - 0.5) * 20;

            sizes[orbIndex] = 4 + Math.random() * 4;

            const color = orbColors[Math.floor(Math.random() * orbColors.length)];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            if (activeOrbs.length < 20) {
                activeOrbs.push({
                    index: orbIndex,
                    life: 2.0,
                    vx: (Math.random() - 0.5) * 2,
                    vy: (Math.random() - 0.5) * 2,
                    vz: (Math.random() - 0.5) * 1
                });
            }
        }

        this.cosmicOrbs.geometry.attributes.position.needsUpdate = true;
        this.cosmicOrbs.geometry.attributes.aSize.needsUpdate = true;
        this.cosmicOrbs.geometry.attributes.aColor.needsUpdate = true;
    }

    createWarpVortex() {
        const geometry = new THREE.TorusGeometry(6, 0.8, 16, 64);

        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: this.uniforms.time,
                opacity: { value: 0.8 },
                rotation: { value: 0 },
                colorA: { value: this.colorPalette.cyan },
                colorB: { value: this.colorPalette.magenta }
            },
            vertexShader: warpVortexVertexShader,
            fragmentShader: warpVortexFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            depthWrite: false
        });

        const vortex = new THREE.Mesh(geometry, material);
        vortex.position.set(
            (Math.random() - 0.5) * 30,
            (Math.random() - 0.5) * 20,
            (Math.random() - 0.5) * 15 - 5
        );

        vortex.userData = {
            life: 2.5,
            maxLife: 2.5,
            rotationSpeed: (Math.random() - 0.5) * 2
        };

        this.mainGroup.add(vortex);
        this.warpVortexes.push(vortex);
    }

    createShootingStar() {
        const trailLength = 25;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(trailLength * 3);
        const progress = new Float32Array(trailLength);

        // Random start position
        const startX = (Math.random() - 0.5) * 80;
        const startY = 20 + Math.random() * 20;
        const startZ = (Math.random() - 0.5) * 40 - 10;

        // Random direction (diagonal down)
        const dirX = (Math.random() - 0.5) * 2;
        const dirY = -1 - Math.random() * 0.5;
        const dirZ = (Math.random() - 0.5);

        for (let i = 0; i < trailLength; i++) {
            positions[i * 3] = startX;
            positions[i * 3 + 1] = startY;
            positions[i * 3 + 2] = startZ;
            progress[i] = i / trailLength;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aProgress', new THREE.BufferAttribute(progress, 1));

        const starColors = [
            new THREE.Color(0xaaffdd),
            new THREE.Color(0xffaaff),
            new THREE.Color(0xffffaa)
        ];

        const material = new THREE.ShaderMaterial({
            uniforms: {
                color: { value: starColors[Math.floor(Math.random() * starColors.length)] },
                opacity: { value: 1.0 }
            },
            vertexShader: shootingStarVertexShader,
            fragmentShader: shootingStarFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });

        const star = new THREE.Points(geometry, material);
        star.userData = {
            direction: new THREE.Vector3(dirX, dirY, dirZ).normalize(),
            speed: 40 + Math.random() * 25,
            life: 1.8,
            maxLife: 1.8,
            headPosition: new THREE.Vector3(startX, startY, startZ)
        };

        this.scene.add(star);
        this.shootingStars.push(star);
    }

    animate() {
        if (!this.isActive) return;

        this.animationFrame = requestAnimationFrame(this.animate.bind(this));

        const delta = this.clock.getDelta();
        const elapsedTime = this.clock.getElapsedTime();
        this.uniforms.time.value = elapsedTime;

        // Decay intensity
        if (this.uniforms.intensity.value > 1.0) {
            this.uniforms.intensity.value = THREE.MathUtils.lerp(
                this.uniforms.intensity.value,
                1.0,
                delta * 1.5
            );
        }
        this.comboIntensity *= 0.97;

        // Slow star rotation
        if (this.starSystem) {
            this.starSystem.rotation.y = elapsedTime * 0.003;
            this.starSystem.rotation.x = Math.sin(elapsedTime * 0.01) * 0.02;
        }

        // Main group drift
        if (this.mainGroup) {
            const driftTime = elapsedTime * 0.06;
            this.mainGroup.position.x = Math.sin(driftTime) * 2;
            this.mainGroup.position.y = Math.cos(driftTime * 0.7) * 1;
            this.mainGroup.rotation.z = Math.sin(driftTime * 0.3) * 0.015;
        }

        // Camera drift
        if (this.camera) {
            const camTime = elapsedTime * 0.04;
            this.camera.position.x = Math.sin(camTime) * 4;
            this.camera.position.y = Math.cos(camTime * 0.6) * 3;
            this.camera.position.z = 30 + Math.sin(camTime * 0.4) * 3;

            const lookX = Math.sin(camTime * 0.8) * 2;
            const lookY = Math.cos(camTime * 0.5) * 1.5;
            this.camera.lookAt(lookX, lookY, 0);
        }

        // Update pulse waves
        this.updatePulseWaves(delta);

        // Update warp vortexes
        this.updateWarpVortexes(delta);

        // Update shooting stars
        this.updateShootingStars(delta);

        // Update cosmic orbs
        this.updateCosmicOrbs(delta);

        // Update bloom intensity
        if (this.bloomPass) {
            this.bloomPass.strength = this.activePreset.bloomStrength * (1 + this.comboIntensity * 0.3);
        }

        // Render
        if (this.composer) {
            this.composer.render(delta);
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    updatePulseWaves(delta) {
        for (let i = this.pulseWaves.length - 1; i >= 0; i--) {
            const wave = this.pulseWaves[i];
            const data = wave.userData;

            data.life -= delta;

            // Expand
            const expansion = data.speed * delta;
            wave.scale.x += expansion * 0.4;
            wave.scale.y += expansion * 0.4;
            wave.scale.z += expansion * 0.3;

            // Fade out
            wave.material.uniforms.opacity.value = (data.life / data.maxLife) * 0.7;

            if (data.life <= 0) {
                this.mainGroup.remove(wave);
                wave.geometry.dispose();
                wave.material.dispose();
                this.pulseWaves.splice(i, 1);
            }
        }
    }

    updateWarpVortexes(delta) {
        for (let i = this.warpVortexes.length - 1; i >= 0; i--) {
            const vortex = this.warpVortexes[i];
            const data = vortex.userData;

            data.life -= delta;
            vortex.rotation.z += data.rotationSpeed * delta;

            // Scale up
            const scale = 1 + (1 - data.life / data.maxLife) * 2;
            vortex.scale.set(scale, scale, 1);

            // Fade out
            vortex.material.uniforms.opacity.value = (data.life / data.maxLife) * 0.8;

            if (data.life <= 0) {
                this.mainGroup.remove(vortex);
                vortex.geometry.dispose();
                vortex.material.dispose();
                this.warpVortexes.splice(i, 1);
            }
        }
    }

    updateShootingStars(delta) {
        for (let i = this.shootingStars.length - 1; i >= 0; i--) {
            const star = this.shootingStars[i];
            const data = star.userData;

            data.life -= delta;

            // Move head
            data.headPosition.addScaledVector(data.direction, data.speed * delta);

            // Update trail positions
            const positions = star.geometry.attributes.position.array;
            const trailLength = positions.length / 3;

            for (let j = trailLength - 1; j > 0; j--) {
                positions[j * 3] = positions[(j - 1) * 3];
                positions[j * 3 + 1] = positions[(j - 1) * 3 + 1];
                positions[j * 3 + 2] = positions[(j - 1) * 3 + 2];
            }

            positions[0] = data.headPosition.x;
            positions[1] = data.headPosition.y;
            positions[2] = data.headPosition.z;

            star.geometry.attributes.position.needsUpdate = true;

            // Fade out
            star.material.uniforms.opacity.value = data.life / data.maxLife;

            if (data.life <= 0) {
                this.scene.remove(star);
                star.geometry.dispose();
                star.material.dispose();
                this.shootingStars.splice(i, 1);
            }
        }
    }

    updateCosmicOrbs(delta) {
        if (!this.cosmicOrbs) return;

        const positions = this.cosmicOrbs.geometry.attributes.position.array;
        const sizes = this.cosmicOrbs.geometry.attributes.aSize.array;
        const activeOrbs = this.cosmicOrbs.userData.activeOrbs;

        for (let i = activeOrbs.length - 1; i >= 0; i--) {
            const orb = activeOrbs[i];
            orb.life -= delta;

            const i3 = orb.index * 3;

            // Move orb
            positions[i3] += orb.vx * delta * 5;
            positions[i3 + 1] += orb.vy * delta * 5;
            positions[i3 + 2] += orb.vz * delta * 3;

            // Slow down
            orb.vx *= 0.98;
            orb.vy *= 0.98;
            orb.vz *= 0.98;

            // Fade size
            sizes[orb.index] *= 0.99;

            if (orb.life <= 0) {
                positions[i3 + 1] = -1000; // Hide
                sizes[orb.index] = 0;
                activeOrbs.splice(i, 1);
            }
        }

        this.cosmicOrbs.geometry.attributes.position.needsUpdate = true;
        this.cosmicOrbs.geometry.attributes.aSize.needsUpdate = true;
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

    dispose() {
        super.dispose();

        window.removeEventListener('resize', this.onWindowResize.bind(this));

        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }

        this.eventUnsubscribers.forEach(unsub => unsub());
        this.eventUnsubscribers = [];

        // Cleanup shooting stars
        this.shootingStars.forEach(star => {
            this.scene.remove(star);
            star.geometry.dispose();
            star.material.dispose();
        });
        this.shootingStars = [];

        // Cleanup pulse waves
        this.pulseWaves.forEach(wave => {
            this.mainGroup.remove(wave);
            wave.geometry.dispose();
            wave.material.dispose();
        });
        this.pulseWaves = [];

        // Cleanup warp vortexes
        this.warpVortexes.forEach(vortex => {
            this.mainGroup.remove(vortex);
            vortex.geometry.dispose();
            vortex.material.dispose();
        });
        this.warpVortexes = [];

        // Cleanup composer
        if (this.composer) {
            this.composer.dispose();
        }

        // Cleanup renderer
        if (this.renderer) {
            this.renderer.dispose();
            const container = document.getElementById('astral-weave-theme');
            if (container && container.contains(this.renderer.domElement)) {
                container.removeChild(this.renderer.domElement);
            }
        }

        // Dispose all scene objects
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
        this.composer = null;
        this.mainGroup = null;
        this.cosmicThreads = [];
        this.starSystem = null;
        this.nebulaParticles = null;
        this.stardustSystem = null;
        this.cosmicOrbs = null;
    }

    getTetrominoConfig() {
        return ASTRAL_WEAVE_TETROMINOS;
    }
}
