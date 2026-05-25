/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  🔥 CINDER DRIFT: VOLCANIC CORE EDITION 🔥
 *  High-Fidelity Magma & Fire Theme
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import * as THREE from 'three';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { CINDER_DRIFT_TETROMINOS } from './cinder-drift-tetrominos.js';
import {
    magmaBackgroundVertexShader,
    magmaBackgroundFragmentShader,
    rockVertexShader,
    rockFragmentShader,
    smokeVertexShader,
    smokeFragmentShader,
    emberVertexShader,
    emberFragmentShader,
    gpuBurstVertexShader,
    gpuBurstFragmentShader,
} from './cinder-drift-shaders.js';

export default class CinderDriftTheme extends BaseTheme {
    constructor() {
        super('cinder-drift');
        this.eventUnsubscribers = [];
        this.boundResizeHandler = this.onWindowResize.bind(this);

        // Pointer tracking for parallax camera
        this.pointerX = 0;
        this.pointerY = 0;
        this.smoothedPointerX = 0;
        this.smoothedPointerY = 0;

        // Three.js components
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.clock = new THREE.Clock();

        // Scene Groups
        this.backgroundGroup = null;
        this.rocksGroup = null;
        this.smokeGroup = null;
        this.embersGroup = null;

        // Custom Objects
        this.rocks = [];
        this.flashIntensity = 0;

        // Magma Explosion System
        this.explosionGroup = null;
        this.explosionActive = false;
        this.explosionProgress = 0;
        this.tendrils = [];
        this.explosionCore = null;
        this.splashParticles = null;

        // Uniforms
        this.uniforms = {
            time: { value: 0 },
            coreIntensity: { value: 1.0 }, // Reactive intensity
            // Palette
            colorPrimary: { value: new THREE.Color(0x1a0500) }, // Dark crust
            colorSecondary: { value: new THREE.Color(0xff4400) }, // Magma
            colorTertiary: { value: new THREE.Color(0xffcc00) }, // Bright heat
        };
    }

    getTetrominoConfig() {
        return CINDER_DRIFT_TETROMINOS;
    }

    async createScene() {
        console.log('[CinderDrift] Initializing Volcanic Core scene...');

        // Activate Cinder Drift sound set
        if (typeof window !== 'undefined' && window.app && window.app.soundManager) {
            // Sound set activation handled by theme-linked settings
        }

        const container = document.getElementById('cinder-drift-theme');
        if (!container) return;
        container.innerHTML = '';

        // 1. Setup
        this.scene = new THREE.Scene();

        // Camera setup for cinematic view
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.z = 40;

        // Renderer
        this.renderer = new THREE.WebGLRenderer({
            alpha: false, // Opaque background for magma
            antialias: this.getAntialiasEnabled(),
            powerPreference: 'high-performance',
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Cap pixel ratio for shader performance
        container.appendChild(this.renderer.domElement);

        // 2. Create Layers
        this.createMagmaBackground();
        this.createVolumetricSmoke();
        this.createEmbers();
        // Old 3D tendril explosion removed - now using shader-based background ripple

        // 3. Post-Processing Setup (if applicable later)
        // Ensure scene is bright enough to look good without bloom first
        this.createBurstSystem();

        // 4. Events
        this.setupEventListeners();
        window.addEventListener('resize', this.boundResizeHandler);

        // 5. Start Loop
        this.animate();
    }

    createBurstSystem() {
        const poolSize = 8;
        this.burstSystemPool = [];
        this.currentBurstIndex = 0;

        const particleCount = 4000; // High count per burst for "thousands"

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3); // Start pos (0,0,0)
        const velocities = new Float32Array(particleCount * 3);
        const lives = new Float32Array(particleCount);
        const sizes = new Float32Array(particleCount);
        const colors = new Float32Array(particleCount * 3);

        for (let i = 0; i < particleCount; i++) {
            // Initial random offset to form a "crater" or volume source
            // This prevents them from looking like they come from a single pixel
            const r = Math.random() * 3.0; // 3 unit radius
            const angle = Math.random() * Math.PI * 2;
            positions[i * 3] = r * Math.cos(angle);
            positions[i * 3 + 1] = r * Math.sin(angle);
            positions[i * 3 + 2] = (Math.random() - 0.5) * 1.0; // Slight Z depth variation

            // Random direction in a cone or sphere - we'll rotate the system itself
            // But for now, let's just make a generic explosive sphere
            // We will customize direction via shader or rotation in triggerBurst
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos((Math.random() * 2) - 1);
            const speed = 10 + Math.random() * 40; // High speed

            velocities[i * 3] = speed * Math.sin(phi) * Math.cos(theta);
            velocities[i * 3 + 1] = speed * Math.sin(phi) * Math.sin(theta);
            velocities[i * 3 + 2] = speed * Math.cos(phi);

            lives[i] = 2.0 + Math.random() * 2.0;
            sizes[i] = 4.0 + Math.random() * 6.0;

            // Ember colors
            const mixVal = Math.random();
            const color = new THREE.Color().setHSL(0.05 + mixVal * 0.1, 1.0, 0.5 + mixVal * 0.3);
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
        geometry.setAttribute('life', new THREE.BufferAttribute(lives, 1));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        for (let i = 0; i < poolSize; i++) {
            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: this.uniforms.time,
                    uStartTime: { value: -999.0 }, // Inactive
                    uIntensity: { value: 1.0 },
                },
                vertexShader: gpuBurstVertexShader,
                fragmentShader: gpuBurstFragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });

            const points = new THREE.Points(geometry.clone(), material);
            points.frustumCulled = false; // Always render
            this.scene.add(points);

            this.burstSystemPool.push({
                mesh: points,
                active: false,
            });
        }
    }

    triggerBurst(count, intensity = 1.0, color = null, origin = null) {
        if (!this.burstSystemPool) return;

        // Get next system in pool
        const system = this.burstSystemPool[this.currentBurstIndex];
        this.currentBurstIndex = (this.currentBurstIndex + 1) % this.burstSystemPool.length;

        // Activate
        system.active = true;
        system.mesh.visible = true;

        // 1. Position
        if (origin) {
            system.mesh.position.copy(origin);
        } else {
            system.mesh.position.set(0, 0, 0);
        }

        // 2. Random rotation (so small 5-particle bursts don't always look identical)
        system.mesh.rotation.set(
            Math.random() * Math.PI,
            Math.random() * Math.PI,
            Math.random() * Math.PI,
        );

        // 3. Set Intensity (Scale size and velocity in shader)
        system.mesh.material.uniforms.uIntensity.value = intensity;

        // 4. Limit particle count (GPU optimization)
        // Ensure count doesn't exceed buffer size (4000)
        const safeCount = Math.min(count, 4000);
        system.mesh.geometry.setDrawRange(0, safeCount);

        // 5. Reset shader time
        system.mesh.material.uniforms.uStartTime.value = this.uniforms.time.value;
    }

    updateBursts(delta) {
        if (!this.burstSystemPool) return;
        // No CPU update needed for positions (GPU handles it)
    }

    // =========================================================================
    // SCENE GENERATION
    // =========================================================================

    createMagmaBackground() {
        // Full screen quad for the flowing lava wall background
        const geometry = new THREE.PlaneGeometry(400, 300);

        // Explosion uniforms for ripple effect
        this.explosionUniforms = {
            explosionCenter: { value: new THREE.Vector2(0.5, 0.5) },
            explosionProgress: { value: 0.0 },
            explosionIntensity: { value: 0.0 },
        };

        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: this.uniforms.time,
                colorPrimary: this.uniforms.colorPrimary,
                colorSecondary: this.uniforms.colorSecondary,
                colorTertiary: this.uniforms.colorTertiary,
                ...this.explosionUniforms,
            },
            vertexShader: magmaBackgroundVertexShader,
            fragmentShader: magmaBackgroundFragmentShader,
            depthWrite: false,
        });

        this.magmaBackgroundMesh = new THREE.Mesh(geometry, material);
        this.magmaBackgroundMesh.position.z = -50;
        this.scene.add(this.magmaBackgroundMesh);
    }

    createVolcanicRocks() {
        this.rocksGroup = new THREE.Group();
        this.scene.add(this.rocksGroup);

        // Create several detailed floating rocks
        const rockConfigs = [
            { size: 5.0, pos: [-25, 10, -20], rotSpeed: 0.05 },
            { size: 3.5, pos: [28, -15, -15], rotSpeed: 0.07 },
            { size: 2.0, pos: [0, 0, -10], rotSpeed: 0.03 }, // Center, further back
            { size: 6.0, pos: [35, 20, -25], rotSpeed: 0.04 },
            { size: 4.0, pos: [-30, -20, -18], rotSpeed: 0.06 },
            // Small debris
            { size: 1.0, pos: [-10, 25, -5], rotSpeed: 0.1 },
            { size: 1.2, pos: [15, -28, -8], rotSpeed: 0.09 },
        ];

        // Detailed geometry for displacement
        const baseGeometry = new THREE.IcosahedronGeometry(1, 40); // High subdivision

        rockConfigs.forEach((config) => {
            const geometry = baseGeometry.clone();
            geometry.scale(config.size, config.size, config.size);

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    time: this.uniforms.time,
                    baseColor: { value: new THREE.Color(0x050100) }, // Nearly black rock
                    glowColor: this.uniforms.colorSecondary,
                    glowIntensity: this.uniforms.coreIntensity,
                },
                vertexShader: rockVertexShader,
                fragmentShader: rockFragmentShader,
            });

            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(...config.pos);

            // Store for animation
            this.rocks.push({
                mesh,
                basePos: new THREE.Vector3(...config.pos),
                rotSpeed: config.rotSpeed,
                randomOffset: Math.random() * 100,
            });

            this.rocksGroup.add(mesh);
        });
    }

    createVolumetricSmoke() {
        const particleCount = 100;
        const geometry = new THREE.BufferGeometry();

        const positions = [];
        const sizes = [];
        const offsets = [];

        for (let i = 0; i < particleCount; i++) {
            positions.push(
                (Math.random() - 0.5) * 100, // x
                (Math.random() - 0.5) * 60 - 20, // y (start lower)
                (Math.random() - 0.5) * 20 + 10, // z (closer to camera)
            );
            sizes.push(10 + Math.random() * 20); // Large soft sprites
            offsets.push(Math.random() * 100);
        }

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
        geometry.setAttribute('offset', new THREE.Float32BufferAttribute(offsets, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: this.uniforms.time,
                color: { value: new THREE.Color(0x331100) }, // Dark reddish smoke
            },
            vertexShader: smokeVertexShader,
            fragmentShader: smokeFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.NormalBlending, // Traditional alpha blend for smoke
        });

        this.smokeGroup = new THREE.Points(geometry, material);
        this.scene.add(this.smokeGroup);
    }

    createEmbers() {
        // High count instanced particles
        const particleCount = 2000;
        const geometry = new THREE.BufferGeometry();

        const positions = [];
        const velocities = [];
        const lives = [];
        const maxLives = [];
        const offsets = [];
        const sizes = [];

        for (let i = 0; i < particleCount; i++) {
            // Source from everywhere
            positions.push(
                (Math.random() - 0.5) * 100, // x
                (Math.random() - 0.5) * 100, // y (full screen)
                (Math.random() - 0.5) * 40 - 10, // z
            );

            velocities.push(
                (Math.random() - 0.5) * 0.5, // vx
                2.0 + Math.random() * 3.0, // vy (fast up)
                (Math.random() - 0.5) * 0.5, // vz
            );

            lives.push(1.0);
            maxLives.push(2.0 + Math.random() * 3.0);
            offsets.push(Math.random() * 100);
            sizes.push(0.5 + Math.random() * 1.5);
        }

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('velocity', new THREE.Float32BufferAttribute(velocities, 3));
        geometry.setAttribute('life', new THREE.Float32BufferAttribute(lives, 1));
        geometry.setAttribute('maxLife', new THREE.Float32BufferAttribute(maxLives, 1));
        geometry.setAttribute('offset', new THREE.Float32BufferAttribute(offsets, 1));
        geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: this.uniforms.time,
            },
            vertexShader: emberVertexShader,
            fragmentShader: emberFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.embersGroup = new THREE.Points(geometry, material);
        this.scene.add(this.embersGroup);
    }

    // =========================================================================
    // 3D MAGMA EXPLOSION SYSTEM
    // =========================================================================

    createMagmaExplosion() {
        this.explosionGroup = new THREE.Group();
        this.explosionGroup.visible = false; // Hidden until triggered
        this.scene.add(this.explosionGroup);

        // 1. Glowing Core - Bright center sphere
        const coreGeometry = new THREE.SphereGeometry(3, 32, 32);
        const coreMaterial = new THREE.ShaderMaterial({
            uniforms: {
                time: this.uniforms.time,
                intensity: { value: 1.0 },
            },
            vertexShader: `
            varying vec3 vNormal;
            void main() {
                vNormal = normal;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
            fragmentShader: `
            uniform float time;
            uniform float intensity;
            varying vec3 vNormal;
            void main() {
                float fresnel = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 2.0);
                vec3 hotColor = mix(vec3(1.0, 0.3, 0.0), vec3(1.0, 1.0, 0.5), fresnel);
                float pulse = 0.8 + 0.2 * sin(time * 10.0);
                gl_FragColor = vec4(hotColor * intensity * pulse, 1.0);
            }
        `,
            blending: THREE.AdditiveBlending,
            transparent: true,
            depthWrite: false,
        });
        this.explosionCore = new THREE.Mesh(coreGeometry, coreMaterial);
        this.explosionGroup.add(this.explosionCore);

        // 2. Lava Tendrils - Curves that shoot upward
        this.tendrils = [];
        const tendrilCount = 12;
        for (let i = 0; i < tendrilCount; i++) {
            const angle = (i / tendrilCount) * Math.PI * 2;
            const tendril = this.createTendril(angle);
            this.tendrils.push(tendril);
            this.explosionGroup.add(tendril.mesh);
        }

        // 3. Splash Particles at the base
        this.createSplashParticles();
    }

    createTendril(angle) {
        // Each tendril is a tube following a bezier curve
        // We'll animate this by regenerating the curve each frame
        const tubeRadius = 0.3 + Math.random() * 0.4;
        const radialOffset = 2 + Math.random() * 2;
        const heightMax = 10 + Math.random() * 15;
        const phase = Math.random() * Math.PI * 2;

        // Initial curve
        const points = this.generateTendrilPoints(angle, radialOffset, 0, heightMax, phase);
        const curve = new THREE.CatmullRomCurve3(points);
        const geometry = new THREE.TubeGeometry(curve, 20, tubeRadius, 8, false);

        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: this.uniforms.time,
            },
            vertexShader: `
            varying vec2 vUv;
            varying vec3 vPosition;
            void main() {
                vUv = uv;
                vPosition = position;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
            fragmentShader: `
            varying vec2 vUv;
            varying vec3 vPosition;
            uniform float time;
            void main() {
                // Hot core to cooler edges
                float edge = 1.0 - abs(vUv.x - 0.5) * 2.0;
                vec3 hotColor = vec3(1.0, 0.9, 0.3); // Yellow/White
                vec3 coolColor = vec3(1.0, 0.2, 0.0); // Deep Red
                vec3 crustColor = vec3(0.1, 0.05, 0.02); // Dark crust
                
                // Vertical gradient - hotter at base
                float heightFade = 1.0 - vUv.y;
                
                vec3 col = mix(coolColor, hotColor, edge * heightFade);
                col = mix(crustColor, col, edge); // Dark edges
                
                float alpha = edge * (1.0 - vUv.y * 0.5);
                gl_FragColor = vec4(col, alpha);
            }
        `,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
        });

        const mesh = new THREE.Mesh(geometry, material);

        return {
            mesh,
            angle,
            radialOffset,
            heightMax,
            tubeRadius,
            phase,
        };
    }

    generateTendrilPoints(angle, radialOffset, progress, heightMax, phase) {
        // Generate bezier-like control points for the tendril
        // Progress 0-1 controls how "extended" the tendril is
        const points = [];
        const segments = 5;
        const actualHeight = heightMax * progress;

        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const height = actualHeight * t;
            // Outward curve that curls back at top
            const outward = radialOffset * Math.sin(t * Math.PI) * (1 + Math.sin(phase + t * 3) * 0.3);
            const x = Math.cos(angle) * outward;
            const z = Math.sin(angle) * outward;
            // Add some waviness
            const wave = Math.sin(t * 4 + phase) * 0.5 * t;
            points.push(new THREE.Vector3(x + wave, height - 5, z + wave));
        }
        return points;
    }

    createSplashParticles() {
        const particleCount = 500;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const velocities = new Float32Array(particleCount * 3);
        const lifetimes = new Float32Array(particleCount);
        const sizes = new Float32Array(particleCount);

        for (let i = 0; i < particleCount; i++) {
            // Start at center-bottom
            positions[i * 3] = 0;
            positions[i * 3 + 1] = -5;
            positions[i * 3 + 2] = 0;

            // Random outward velocity
            const angle = Math.random() * Math.PI * 2;
            const speed = 5 + Math.random() * 15;
            const upSpeed = 10 + Math.random() * 20;
            velocities[i * 3] = Math.cos(angle) * speed;
            velocities[i * 3 + 1] = upSpeed;
            velocities[i * 3 + 2] = Math.sin(angle) * speed;

            lifetimes[i] = 0; // Inactive
            sizes[i] = 0.2 + Math.random() * 0.5;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
        geometry.setAttribute('lifetime', new THREE.BufferAttribute(lifetimes, 1));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: this.uniforms.time,
            },
            vertexShader: `
            attribute float lifetime;
            attribute float size;
            varying float vLife;
            void main() {
                vLife = lifetime;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mvPosition;
                gl_PointSize = size * (200.0 / -mvPosition.z) * lifetime;
            }
        `,
            fragmentShader: `
            varying float vLife;
            void main() {
                if (vLife <= 0.0) discard;
                vec2 uv = gl_PointCoord - 0.5;
                float dist = length(uv);
                if (dist > 0.5) discard;
                float glow = 1.0 - dist * 2.0;
                vec3 col = mix(vec3(1.0, 0.2, 0.0), vec3(1.0, 1.0, 0.5), glow);
                gl_FragColor = vec4(col, glow * vLife);
            }
        `,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.splashParticles = new THREE.Points(geometry, material);
        this.splashParticles.frustumCulled = false;
        this.explosionGroup.add(this.splashParticles);
    }

    triggerMagmaExplosion(x = 0, y = -10) {
        if (this.explosionActive) return; // Don't overlap explosions

        this.explosionActive = true;
        this.explosionProgress = 0;
        this.explosionGroup.visible = true;
        this.explosionGroup.position.set(x, y, 0);

        // Reset splash particles
        const positions = this.splashParticles.geometry.attributes.position.array;
        const lifetimes = this.splashParticles.geometry.attributes.lifetime.array;
        const velocities = this.splashParticles.geometry.attributes.velocity.array;
        for (let i = 0; i < lifetimes.length; i++) {
            positions[i * 3] = 0;
            positions[i * 3 + 1] = 0;
            positions[i * 3 + 2] = 0;
            lifetimes[i] = 1.0;
            // Re-randomize velocity
            const angle = Math.random() * Math.PI * 2;
            const speed = 5 + Math.random() * 15;
            const upSpeed = 10 + Math.random() * 20;
            velocities[i * 3] = Math.cos(angle) * speed;
            velocities[i * 3 + 1] = upSpeed;
            velocities[i * 3 + 2] = Math.sin(angle) * speed;
        }
        this.splashParticles.geometry.attributes.position.needsUpdate = true;
        this.splashParticles.geometry.attributes.lifetime.needsUpdate = true;
        this.splashParticles.geometry.attributes.velocity.needsUpdate = true;
    }

    // NEW: Trigger shader-based ripple on background
    triggerBackgroundExplosion(uvX = 0.5, uvY = 0.5) {
        if (!this.explosionUniforms) return;

        // Set explosion center in UV coords (0-1) SCALED by 1.5 to match shader
        this.explosionUniforms.explosionCenter.value.set(uvX * 1.5, uvY * 1.5);
        this.explosionUniforms.explosionProgress.value = 0.0;
        this.explosionUniforms.explosionIntensity.value = 1.0;
        this.explosionActive = true;
    }

    updateMagmaExplosion(delta) {
        // Update 3D explosion group (old system - still running for particles)
        if (this.explosionGroup && this.explosionGroup.visible) {
            const explosionDuration = 2.0;
            this.explosionProgress += delta / explosionDuration;

            if (this.explosionProgress >= 1.0) {
                this.explosionGroup.visible = false;
            } else {
                // Core animation
                if (this.explosionCore) {
                    const coreScale = Math.sin(this.explosionProgress * Math.PI) * 2;
                    this.explosionCore.scale.set(coreScale, coreScale, coreScale);
                    this.explosionCore.material.uniforms.intensity.value = 1.0 - this.explosionProgress * 0.5;
                }

                // Splash particles
                if (this.splashParticles) {
                    const positions = this.splashParticles.geometry.attributes.position.array;
                    const velocities = this.splashParticles.geometry.attributes.velocity.array;
                    const lifetimes = this.splashParticles.geometry.attributes.lifetime.array;
                    const gravity = -30;

                    for (let i = 0; i < lifetimes.length; i++) {
                        if (lifetimes[i] > 0) {
                            positions[i * 3] += velocities[i * 3] * delta;
                            positions[i * 3 + 1] += velocities[i * 3 + 1] * delta;
                            positions[i * 3 + 2] += velocities[i * 3 + 2] * delta;
                            velocities[i * 3 + 1] += gravity * delta;
                            lifetimes[i] -= delta * 0.5;
                        }
                    }
                    this.splashParticles.geometry.attributes.position.needsUpdate = true;
                    this.splashParticles.geometry.attributes.lifetime.needsUpdate = true;
                }
            }
        }

        // Update shader-based ripple effect on background
        if (this.explosionUniforms && this.explosionActive) {
            const rippleDuration = 4.0; // seconds (increased from 1.5)
            this.explosionUniforms.explosionProgress.value += delta / rippleDuration;

            if (this.explosionUniforms.explosionProgress.value >= 1.0) {
                this.explosionActive = false;
                this.explosionUniforms.explosionProgress.value = 0.0;
                this.explosionUniforms.explosionIntensity.value = 0.0;
            }
        }
    }

    // =========================================================================
    // ANIMATION & EVENTS
    // =========================================================================

    animate() {
        if (!this.isActive) return;

        this.animationFrame = requestAnimationFrame(this.animate.bind(this));

        const delta = this.clock.getDelta();
        const time = this.clock.getElapsedTime();
        this.uniforms.time.value = time;

        // Update bursts
        this.updateBursts(delta);

        // Update magma explosion
        this.updateMagmaExplosion(delta);

        // 1. Rock Animation (Drift & Bob)
        this.rocks.forEach((rock, i) => {
            // Slow rotation
            rock.mesh.rotation.x = time * rock.rotSpeed * 0.5;
            rock.mesh.rotation.y = time * rock.rotSpeed;

            // Perlin-like gentle bobbing
            rock.mesh.position.y = rock.basePos.y + Math.sin(time * 0.5 + rock.randomOffset) * 2.0;
            rock.mesh.position.x = rock.basePos.x + Math.cos(time * 0.3 + rock.randomOffset) * 1.0;
        });

        // 2. Camera Shake / Drift
        const intensity = this.uniforms.coreIntensity.value - 1.0; // 0 at base
        const shakeX = (Math.random() - 0.5) * intensity * 0.2;
        const shakeY = (Math.random() - 0.5) * intensity * 0.2;

        // Smooth pointer tracking for subtle mouse parallax
        this.smoothedPointerX = THREE.MathUtils.lerp(this.smoothedPointerX, this.pointerX, delta * 2.2);
        this.smoothedPointerY = THREE.MathUtils.lerp(this.smoothedPointerY, this.pointerY, delta * 2.2);
        const parallaxX = this.smoothedPointerX * 5.0;
        const parallaxY = -this.smoothedPointerY * 2.5;

        // Gentle cinematic orbit + mouse parallax
        this.camera.position.x = Math.sin(time * 0.1) * 5 + shakeX + parallaxX;
        this.camera.position.y = Math.cos(time * 0.15) * 3 + shakeY + parallaxY;
        this.camera.lookAt(parallaxX * 0.4, parallaxY * 0.4, 0);

        // 3. Intensity Decay
        if (this.uniforms.coreIntensity.value > 1.0) {
            this.uniforms.coreIntensity.value -= delta * 0.5;
            if (this.uniforms.coreIntensity.value < 1.0) this.uniforms.coreIntensity.value = 1.0;
        }

        // 4. Flash Decay
        if (this.flashIntensity > 0) {
            this.flashIntensity -= delta * 3.0; // Fast fade
            if (this.flashIntensity < 0) this.flashIntensity = 0;

            // Add flash to tertiary color (brightens magma)
            this.uniforms.colorTertiary.value.setHSL(
                0.12,
                1.0,
                0.5 + this.flashIntensity * 0.5,
            );
        } else {
            this.uniforms.colorTertiary.value.setHex(0xffcc00); // Reset
        }

        this.renderer.render(this.scene, this.camera);
    }

    setupEventListeners() {
        this.eventUnsubscribers.push(
            eventBus.on(EVENTS.LINE_CLEAR, (data) => {
                if (!this.isActive) return;
                const count = data.lines || 1;
                this.triggerSurge(count);
                this.triggerBurst(20 * count, 1.0, new THREE.Color(0xff4400));
            }),
            eventBus.on(EVENTS.COMBO, (data) => {
                if (!this.isActive) return;
                const combo = data.combo || 1;
                this.triggerSurge(combo * 1.5);

                // Random location for the explosion - CONSTRAINED TO VISIBLE AREA
                // Camera sees roughly 45% of the width and 35% of the height
                // So UVs should be centered around 0.5 within that range
                const visibleRangeX = 0.4; // 0.3 to 0.7
                const visibleRangeY = 0.35; // 0.325 to 0.675

                const u = 0.5 + (Math.random() - 0.5) * visibleRangeX;
                const v = 0.5 + (Math.random() - 0.5) * visibleRangeY;

                // Shader-based ripple on background!
                this.triggerBackgroundExplosion(u, v);

                // Calculate 3D position from UV to match visual explosion location
                // Plane is 400x300 at z = -50
                const worldX = (u - 0.5) * 400;
                const worldY = (v - 0.5) * 300;
                const explosionPos = new THREE.Vector3(worldX, worldY, -49); // Align closely with wall (-50) to fix parallax

                // "Much glowing particles" for combo - SHOOTING AT CAMERA
                // Scale up count significantly now that we limit draw range
                this.triggerBurst(4000 * combo, 2.0, new THREE.Color(0xffcc00), explosionPos);
            }),
            eventBus.on(EVENTS.PIECE_LOCK, () => {
                if (!this.isActive) return;
                this.triggerMiniPulse();

                // Random position for piece lock puff
                const visibleRangeX = 0.4;
                const visibleRangeY = 0.35;
                const u = 0.5 + (Math.random() - 0.5) * visibleRangeX;
                const v = 0.5 + (Math.random() - 0.5) * visibleRangeY;

                const worldX = (u - 0.5) * 400;
                const worldY = (v - 0.5) * 300;
                const puffPos = new THREE.Vector3(worldX, worldY, -49);

                this.triggerBurst(100, 0.5, new THREE.Color(0xff8800), puffPos);
            }),
        );

        // Pointer tracking for parallax camera
        const onPointerMove = (e) => {
            if (!this.isActive) return;
            this.pointerX = (e.clientX / window.innerWidth) * 2 - 1;
            this.pointerY = (e.clientY / window.innerHeight) * 2 - 1;
        };
        window.addEventListener('pointermove', onPointerMove);
        this.eventUnsubscribers.push(() => window.removeEventListener('pointermove', onPointerMove));
    }

    triggerSurge(strength) {
        // Boost glow intensity
        this.uniforms.coreIntensity.value += strength * 0.5;
        this.flashIntensity = 1.0; // Flash effect

        // Maybe spawn shockwave? (Not implemented in V2 yet, relies on shader intensity)
    }

    triggerMiniPulse() {
        this.uniforms.coreIntensity.value += 0.1;
    }

    onWindowResize() {
        if (!this.camera || !this.renderer) return;
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    resize(width, height) {
        if (!this.camera || !this.renderer) return;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    stop() {
        if (!this.isActive) return;
        super.stop();
        this.eventUnsubscribers.forEach((u) => u());
        this.eventUnsubscribers = [];
        window.removeEventListener('resize', this.boundResizeHandler);
    }

    cleanup() {
        this.stop();
        if (this.animationFrame) cancelAnimationFrame(this.animationFrame);

        if (this.renderer) {
            this.renderer.dispose();
            const container = document.getElementById('cinder-drift-theme');
            if (container && container.contains(this.renderer.domElement)) {
                container.removeChild(this.renderer.domElement);
            }
        }

        // Clean scene
        if (this.scene) {
            this.scene.traverse((obj) => {
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) obj.material.dispose();
            });
        }

        this.scene = null;
        this.renderer = null;
        super.cleanup();
        console.log('[CinderDrift] Cleanup complete');
    }
}
