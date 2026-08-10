/**
 * Three.js Intro Renderer
 * Renders the 3D intro animation with drifting tetrominos, particles, and atmosphere
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { IntroCameraParallax } from './intro-camera-parallax.js';
import { COLORS } from '../core/constants.js';
import {
    INTRO_TETROMINO_CLICK_IMPULSE,
    INTRO_TETROMINO_MAX_SPEED,
    clampVectorMagnitude,
    computeImpulseAwayFromRay,
    getPointerNdcFromClient,
} from './intro-tetromino-interactions.js';

// Camera idle-drift amplitudes — must match the values used in update().
// Used (together with the pointer-parallax orbit amplitudes) to compute how far
// the visible frame can ever travel, so tetrominos spawn beyond that envelope
// and always drift in from off-screen instead of popping into view.
const CAMERA_IDLE_AMP_X = 5;
const CAMERA_IDLE_AMP_Y = 3;
// Extra clearance beyond the reveal envelope so a piece's whole body (not just
// its center) starts fully off-screen.
const SPAWN_CLEARANCE = 6;
// Minimum inward drift so pieces cross the (now larger) off-screen margin in a
// few seconds instead of crawling in.
const SPAWN_INWARD_DRIFT = 0.05;

function toPlainRay(ray) {
    return {
        origin: {
            x: ray.origin.x,
            y: ray.origin.y,
            z: ray.origin.z,
        },
        direction: {
            x: ray.direction.x,
            y: ray.direction.y,
            z: ray.direction.z,
        },
    };
}

export default class ThreeJSIntroRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.composer = null;
        this.envMap = null;

        // Scene elements
        this.starSystem = null;
        this.particles = null;
        this.tetrominos = [];
        this.activeTetrominos = [];
        this.activeParticles = [];

        // New visual effects
        this.shootingStars = [];
        this.sparkleLayer = null;
        this.nebulaClouds = [];
        this.nebulaSky = null; // Phase F: GLSL nebula backdrop (parity with WebGPU path)
        this.nebulaSkyUniforms = null;
        this.lastShootingStarTime = 0;
        this.boundResizeHandler = this.onResize.bind(this);

        // Animation state
        this.clock = new THREE.Clock();
        this.lastSpawnTime = 0;
        this.raycaster = new THREE.Raycaster();

        // Pointer-driven camera parallax (cursor arcs the camera around the scene).
        this.cameraParallax = new IntroCameraParallax();

        // PERFORMANCE: Object pools for collision effects and shooting stars
        this.collisionEffectPool = [];
        this.shootingStarPool = [];
        this.COLLISION_POOL_SIZE = 10;
        this.SHOOTING_STAR_POOL_SIZE = 5;

        // Constants — single source of truth for the default piece palette.
        // THREE.Color accepts the '#rrggbb' strings directly, so no conversion.
        this.COLORS = COLORS;

        // Tetromino shapes based on constants.js but optimized for 3D construction
        // relative coordinates from center
        this.SHAPES = {
            I: [[-1.5, 0], [-0.5, 0], [0.5, 0], [1.5, 0]],
            O: [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]],
            T: [[-0.5, 0], [0.5, 0], [0, 0], [0, 1]], // Adjusted for center
            S: [[0, 0], [1, 0], [-1, 1], [0, 1]],
            Z: [[-1, 0], [0, 0], [0, 1], [1, 1]],
            J: [[-1, 1], [-1, 0], [0, 0], [1, 0]],
            L: [[1, 1], [1, 0], [0, 0], [-1, 0]],
        };

        // Vibrant Chromadelic Palette
        this.GALAXY_COLORS = [
            0xFF3366, // Hot Pink
            0x00FFFF, // Cyan
            0xFFFF00, // Yellow
            0xFF6600, // Orange
            0x9933FF, // Purple
            0x00FF66, // Mint Green
            0xFF0099, // Magenta
            0x3399FF, // Electric Blue
        ];
    }

    /**
     * Initialize Three.js scene
     */
    init() {
        if (!this.canvas) return false;

        try {
            // Setup Renderer
            this.renderer = new THREE.WebGLRenderer({
                canvas: this.canvas,
                alpha: true,
                antialias: true,
                powerPreference: 'high-performance',
            });
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            // PERFORMANCE: Cap pixel ratio at 1.5 for intro (temporary screen, reduces fill rate)
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
            this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            this.renderer.toneMappingExposure = 1.2;

            // Setup Scene
            this.scene = new THREE.Scene();
            // Deep indigo fog so distant particles dissolve into the nebula backdrop
            // (matches the WebGPU path).
            this.scene.fog = new THREE.FogExp2(0x0a0620, 0.0058);

            // Setup Camera
            this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
            this.camera.position.z = 40;

            // Phase F — volumetric nebula sky backdrop (replaces the empty black void).
            this.createNebulaSky();

            // Create environment map for crystal reflections
            this.createEnvironmentMap();

            // Setup Lighting
            this.setupLighting();

            // Create Objects
            this.createStarField();
            this.createNebulaParticles();
            this.createSparkleLayer();
            this.createNebulaClouds();

            // Start spawning tetrominos
            this.initCachedResources();
            this.spawnInitialTetrominos();

            // PERFORMANCE: Initialize object pools
            this.initObjectPools();

            // Setup post-processing (bloom for crystal glow)
            this.setupPostProcessing();

            window.addEventListener('resize', this.boundResizeHandler);
            this.cameraParallax.attach();

            return true;
        } catch (e) {
            console.error('[ThreeJSIntroRenderer] Initialization failed:', e);
            return false;
        }
    }

    /**
     * Phase F — GLSL nebula sky (WebGL parity with the WebGPU inverted-sphere
     * backdrop): indigo→violet→teal gradient, domain-warped FBM highlight pockets
     * (cyan/magenta), title-framing front-fade, and procedural stars.
     */
    createNebulaSky() {
        const geometry = new THREE.SphereGeometry(200, 24, 16);
        const uniforms = {
            uTime: { value: 0 },
            uIntensity: { value: 1.0 },
        };
        const material = new THREE.ShaderMaterial({
            uniforms,
            side: THREE.BackSide,
            depthWrite: false,
            fog: false,
            vertexShader: `
                varying vec3 vDir;
                void main() {
                    vDir = (modelMatrix * vec4(position, 1.0)).xyz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                precision highp float;
                varying vec3 vDir;
                uniform float uTime;
                uniform float uIntensity;

                float hash3(vec3 p){
                    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
                    p += dot(p, p.yzx + 33.33);
                    return fract((p.x + p.y) * p.z);
                }
                float vnoise3(vec3 p){
                    vec3 i = floor(p); vec3 f = fract(p);
                    vec3 u = f * f * (3.0 - 2.0 * f);
                    float a = hash3(i + vec3(0.0,0.0,0.0));
                    float b = hash3(i + vec3(1.0,0.0,0.0));
                    float c = hash3(i + vec3(0.0,1.0,0.0));
                    float d = hash3(i + vec3(1.0,1.0,0.0));
                    float e = hash3(i + vec3(0.0,0.0,1.0));
                    float f1= hash3(i + vec3(1.0,0.0,1.0));
                    float g = hash3(i + vec3(0.0,1.0,1.0));
                    float h = hash3(i + vec3(1.0,1.0,1.0));
                    return mix(mix(mix(a,b,u.x), mix(c,d,u.x), u.y),
                               mix(mix(e,f1,u.x), mix(g,h,u.x), u.y), u.z);
                }
                float fbm3(vec3 p){
                    float v = 0.0; float a = 0.5;
                    for (int i = 0; i < 4; i++){ v += a * vnoise3(p); p *= 2.0; a *= 0.5; }
                    return v;
                }
                float warpedFbm3(vec3 p){
                    vec3 w = vec3(fbm3(p), fbm3(p + vec3(5.2,1.3,0.0)), fbm3(p + vec3(0.0,7.7,3.1)));
                    return fbm3(p + w * 2.1);
                }
                float hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
                float vnoise2(vec2 p){
                    vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
                    return mix(mix(hash2(i), hash2(i+vec2(1.0,0.0)), u.x),
                               mix(hash2(i+vec2(0.0,1.0)), hash2(i+vec2(1.0,1.0)), u.x), u.y);
                }
                void main(){
                    vec3 dir = normalize(vDir);
                    float elev = dir.y;

                    vec3 COL_DEEP   = vec3(0.018, 0.010, 0.055);
                    vec3 COL_VIOLET = vec3(0.090, 0.045, 0.190);
                    vec3 COL_TEAL   = vec3(0.030, 0.110, 0.180);
                    vec3 HI_MAGENTA = vec3(0.520, 0.120, 0.620);
                    vec3 HI_CYAN    = vec3(0.080, 0.520, 0.680);

                    vec3 lower = mix(COL_DEEP, COL_VIOLET, smoothstep(-0.6, 0.1, elev));
                    vec3 upper = mix(COL_VIOLET, COL_TEAL, smoothstep(0.0, 0.7, elev));
                    vec3 grad  = mix(lower, upper, smoothstep(-0.1, 0.5, elev));

                    vec3 cc = dir * 2.6 + vec3(uTime * 0.035);
                    float base = warpedFbm3(cc);
                    float detail = fbm3(dir * 6.5 + vec3(uTime * 0.05));
                    float neb = base * 0.8 + detail * 0.2;

                    float frontFade = smoothstep(-1.0, -0.2, dir.z) * 0.7 + 0.3;
                    float mask = smoothstep(0.54, 0.88, neb) * frontFade;
                    float hue = sin(dir.x * 2.3 + dir.z * 1.7 + uTime * 0.05) * 0.5 + 0.5;
                    vec3 hi = mix(HI_CYAN, HI_MAGENTA, hue);
                    vec3 col = mix(grad, hi, mask * 0.42);

                    vec2 starUv = (dir.xy + dir.zz * 0.5) * 90.0;
                    float sn = vnoise2(starUv);
                    float sm = smoothstep(0.986, 1.0, sn) * smoothstep(-0.2, 0.4, elev);
                    col += vec3(0.85, 0.92, 1.0) * sm;

                    gl_FragColor = vec4(clamp(col, 0.0, 1.0) * uIntensity, 1.0);
                }
            `,
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.renderOrder = -1000;
        mesh.frustumCulled = false;
        this.nebulaSky = mesh;
        this.nebulaSkyUniforms = uniforms;
        this.scene.add(mesh);
    }

    setupLighting() {
        // Ambient light (deep purple/blue base) - Increased intensity
        const ambientLight = new THREE.AmbientLight(0x402060, 2.0);
        this.scene.add(ambientLight);

        // Dynamic colored lights for depth - Brighter and more colorful
        const light1 = new THREE.PointLight(0x00ffff, 2.0, 100);
        light1.position.set(20, 20, 20);
        this.scene.add(light1);

        const light2 = new THREE.PointLight(0xff00ff, 2.0, 100);
        light2.position.set(-20, -10, 10);
        this.scene.add(light2);

        const light3 = new THREE.PointLight(0x3399ff, 1.5, 100);
        light3.position.set(0, -30, 0);
        this.scene.add(light3);
    }

    createStarField() {
        const starCount = 3000;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(starCount * 3);
        const sizes = new Float32Array(starCount);
        const colors = new Float32Array(starCount * 3);

        const colorPalette = this.GALAXY_COLORS.map((c) => new THREE.Color(c));

        for (let i = 0; i < starCount; i++) {
            const i3 = i * 3;
            // Distribute in a large volume
            positions[i3] = (Math.random() - 0.5) * 300;
            positions[i3 + 1] = (Math.random() - 0.5) * 300;
            positions[i3 + 2] = (Math.random() - 0.5) * 200 - 50;

            sizes[i] = Math.random() * 0.5 + 0.1;

            const color = colorPalette[Math.floor(Math.random() * colorPalette.length)];
            // Mix with white for stars
            colors[i3] = color.r * 0.7 + 0.3;
            colors[i3 + 1] = color.g * 0.7 + 0.3;
            colors[i3 + 2] = color.b * 0.7 + 0.3;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.PointsMaterial({
            size: 0.5,
            vertexColors: true,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            sizeAttenuation: true,
        });

        this.starSystem = new THREE.Points(geometry, material);
        this.scene.add(this.starSystem);
    }

    createNebulaParticles() {
        // Reduced particle count for cleaner look
        const particleCount = 80;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);
        const randoms = new Float32Array(particleCount); // For phase offset

        const colorPalette = this.GALAXY_COLORS.map((c) => new THREE.Color(c));

        for (let i = 0; i < particleCount; i++) {
            const i3 = i * 3;

            // Spiral/Galaxy distribution
            const angle = Math.random() * Math.PI * 2;
            const radius = 10 + Math.random() * 50;
            const spread = 5;

            positions[i3] = Math.cos(angle) * radius + (Math.random() - 0.5) * spread;
            positions[i3 + 1] = (Math.random() - 0.5) * 40;
            positions[i3 + 2] = Math.sin(angle) * radius - 20 + (Math.random() - 0.5) * spread;

            const color = colorPalette[Math.floor(Math.random() * colorPalette.length)];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            sizes[i] = 1.0 + Math.random() * 2.0;
            randoms[i] = Math.random();
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));

        // Custom Shader Material for Soft Glow
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uPulse: { value: 1.0 },
            },
            vertexShader: `
                uniform float uTime;
                uniform float uPulse;
                attribute float aRandom;
                attribute float size;
                attribute vec3 color;
                varying vec3 vColor;

                void main() {
                    vColor = color;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_Position = projectionMatrix * mvPosition;

                    // Pulsing size
                    float pulse = 1.0 + sin(uTime * 2.0 + aRandom * 10.0) * 0.2;
                    
                    // Size attenuation
                    gl_PointSize = size * pulse * (300.0 / -mvPosition.z);
                }
            `,
            fragmentShader: `
                varying vec3 vColor;

                void main() {
                    // Soft circular glow
                    vec2 center = gl_PointCoord - vec2(0.5);
                    float dist = length(center);
                    
                    // Alpha falloff
                    float alpha = smoothstep(0.5, 0.0, dist);
                    
                    // Bright core
                    float core = smoothstep(0.2, 0.0, dist);
                    
                    vec3 finalColor = vColor + core * 0.5; // Add white core mix
                    
                    gl_FragColor = vec4(finalColor, alpha * 0.8);
                }
            `,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.particles = new THREE.Points(geometry, material);
        this.scene.add(this.particles);
    }

    /**
     * Create twinkling diamond dust sparkle layer
     */
    createSparkleLayer() {
        // Reduced sparkle count for subtler effect
        const sparkleCount = 100;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(sparkleCount * 3);
        const sizes = new Float32Array(sparkleCount);
        const phases = new Float32Array(sparkleCount);

        for (let i = 0; i < sparkleCount; i++) {
            const i3 = i * 3;
            positions[i3] = (Math.random() - 0.5) * 150;
            positions[i3 + 1] = (Math.random() - 0.5) * 100;
            positions[i3 + 2] = (Math.random() - 0.5) * 100 - 30;
            sizes[i] = Math.random() * 0.3 + 0.1;
            phases[i] = Math.random() * Math.PI * 2;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: { uTime: { value: 0 } },
            vertexShader: `
                uniform float uTime;
                attribute float size;
                attribute float phase;
                varying float vAlpha;
                void main() {
                    vAlpha = abs(sin(uTime * 3.0 + phase)) * 0.8 + 0.2;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_Position = projectionMatrix * mvPosition;
                    gl_PointSize = size * vAlpha * (200.0 / -mvPosition.z);
                }
            `,
            fragmentShader: `
                varying float vAlpha;
                void main() {
                    vec2 center = gl_PointCoord - vec2(0.5);
                    float dist = length(center);
                    if (dist > 0.5) discard;
                    float alpha = smoothstep(0.5, 0.0, dist) * vAlpha;
                    gl_FragColor = vec4(1.0, 1.0, 1.0, alpha);
                }
            `,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.sparkleLayer = new THREE.Points(geometry, material);
        this.scene.add(this.sparkleLayer);
    }

    /**
     * Create animated nebula clouds (soft flowing shapes)
     */
    createNebulaClouds() {
        const cloudCount = 5;
        const cloudColors = [0xFF3366, 0x9933FF, 0x3399FF, 0x00FFFF, 0xFF0099];

        for (let i = 0; i < cloudCount; i++) {
            const geometry = new THREE.PlaneGeometry(50 + Math.random() * 30, 30 + Math.random() * 20);
            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uColor: { value: new THREE.Color(cloudColors[i % cloudColors.length]) },
                    uSeed: { value: Math.random() * 100 },
                },
                vertexShader: `
                    varying vec2 vUv;
                    void main() {
                        vUv = uv;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform float uTime;
                    uniform vec3 uColor;
                    uniform float uSeed;
                    varying vec2 vUv;
                    
                    float noise(vec2 p) {
                        return fract(sin(dot(p, vec2(12.9898, 78.233) + uSeed)) * 43758.5453);
                    }
                    
                    void main() {
                        vec2 center = vUv - vec2(0.5);
                        float dist = length(center);
                        
                        float n = noise(vUv * 3.0 + uTime * 0.1);
                        float flow = sin(uTime * 0.5 + vUv.x * 4.0 + n * 2.0) * 0.5 + 0.5;
                        
                        float alpha = smoothstep(0.5, 0.0, dist) * flow * 0.15;
                        gl_FragColor = vec4(uColor, alpha);
                    }
                `,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
            });

            const cloud = new THREE.Mesh(geometry, material);
            // Position clouds firmly in upper left corner
            cloud.position.set(
                -45 - Math.random() * 20, // Far left (-45 to -65)
                25 + Math.random() * 15, // High up (25 to 40)
                -40 - Math.random() * 30,
            );
            cloud.rotation.z = Math.random() * Math.PI;
            cloud.userData = { driftSpeed: 0.02 + Math.random() * 0.03 };

            this.nebulaClouds.push(cloud);
            this.scene.add(cloud);
        }
    }

    /**
     * Spawn a shooting star with trail
     * PERFORMANCE: Uses pooled trail geometry instead of creating new
     */
    spawnShootingStar() {
        // Find an inactive pooled shooting star
        const pooled = this.shootingStarPool.find((s) => !s.userData.active);
        if (!pooled) return; // All pool items busy, skip

        const startX = (Math.random() - 0.5) * 100 + 30;
        const startY = 40 + Math.random() * 20;
        const startZ = -20 - Math.random() * 30;

        // Reset velocity
        pooled.userData.velocity.set(
            -0.8 - Math.random() * 0.5,
            -0.5 - Math.random() * 0.3,
            0,
        );

        // Reset trail positions
        const { trailLength } = pooled.userData;
        const positions = pooled.geometry.attributes.position.array;

        for (let i = 0; i < trailLength; i++) {
            positions[i * 3] = startX;
            positions[i * 3 + 1] = startY;
            positions[i * 3 + 2] = startZ;
        }

        pooled.geometry.attributes.position.needsUpdate = true;
        pooled.userData.life = 2.0;
        pooled.userData.active = true;
        pooled.visible = true;
    }

    /**
     * Create procedural environment map for crystal reflections
     * Similar to geode-theme approach
     */
    createEnvironmentMap() {
        const size = 128;
        const faces = [];

        // Chromadelic color palette for glowing spots
        const spotColors = [
            '#FF3366', '#00FFFF', '#FFFF00', '#FF6600',
            '#9933FF', '#00FF66', '#FF0099', '#3399FF',
        ];

        for (let i = 0; i < 6; i++) {
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');

            // Base gradient - deep purple cosmic void
            const gradient = ctx.createRadialGradient(
                size / 2,
                size / 2,
                0,
                size / 2,
                size / 2,
                size * 0.7,
            );
            gradient.addColorStop(0, '#1a0033');
            gradient.addColorStop(0.3, '#0d001a');
            gradient.addColorStop(0.6, '#080010');
            gradient.addColorStop(1, '#030005');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, size, size);

            // Add glowing chromatic spots
            const spotCount = 20 + Math.floor(Math.random() * 15);
            for (let j = 0; j < spotCount; j++) {
                const x = Math.random() * size;
                const y = Math.random() * size;
                const r = 2 + Math.random() * 10;
                const color = spotColors[Math.floor(Math.random() * spotColors.length)];

                const spotGrad = ctx.createRadialGradient(x, y, 0, x, y, r);
                spotGrad.addColorStop(0, color);
                spotGrad.addColorStop(0.5, `${color}80`);
                spotGrad.addColorStop(1, 'transparent');
                ctx.fillStyle = spotGrad;
                ctx.fillRect(x - r, y - r, r * 2, r * 2);
            }

            faces.push(canvas);
        }

        this.envMap = new THREE.CubeTexture(faces);
        this.envMap.needsUpdate = true;
    }

    /**
     * Setup post-processing with bloom for crystal glow effect
     */
    setupPostProcessing() {
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        // PERFORMANCE: Half-resolution bloom (imperceptible difference, major perf gain)
        const bloomPass = new UnrealBloomPass(
            new THREE.Vector2(Math.floor(window.innerWidth / 2), Math.floor(window.innerHeight / 2)),
            0.6, // strength - toned down to prevent over-shine
            0.4, // radius - moderate glow spread
            0.85, // threshold - higher threshold = fewer bright spots bloom
        );
        this.composer.addPass(bloomPass);
        this.bloomPass = bloomPass;
    }

    /**
     * Pre-calculate all geometries and materials to avoid per-frame creation.
     * Using MeshPhysicalMaterial for crystal-like glass appearance
     */
    initCachedResources() {
        this.cachedResources = {};

        const shapeKeys = Object.keys(this.SHAPES);

        // Common Extrude Settings
        const extrudeSettings = {
            depth: 1.8,
            bevelEnabled: true,
            bevelThickness: 0.15,
            bevelSize: 0.15,
            bevelSegments: 3,
        };

        shapeKeys.forEach((type) => {
            const color = this.COLORS[type];
            const threeColor = new THREE.Color(color);
            const threeShape = this.createTetrominoShape(type);

            // 1. Geometry
            const geometry = new THREE.ExtrudeGeometry(threeShape, extrudeSettings);
            geometry.computeBoundingBox();
            const centerOffset = new THREE.Vector3();
            geometry.boundingBox.getCenter(centerOffset).negate();
            geometry.translate(centerOffset.x, centerOffset.y, centerOffset.z);

            // PERFORMANCE: MeshStandardMaterial instead of MeshPhysicalMaterial
            // Removes expensive transmission/refraction while keeping same visual glow
            const material = new THREE.MeshStandardMaterial({
                color: threeColor.clone().multiplyScalar(0.6), // Slightly darker base
                emissive: threeColor,
                emissiveIntensity: 0.5, // Reduced glow to prevent over-shine
                roughness: 0.05, // Very smooth like glass
                metalness: 0.1, // Slight metalness for shininess
                envMap: this.envMap,
                envMapIntensity: 0.5, // Environment reflections
                transparent: true,
                opacity: 0.9,
                side: THREE.DoubleSide,
            });

            // 3. Edges (Glow Outline) - Brighter for crystal effect
            const edgesGeometry = new THREE.EdgesGeometry(geometry, 25);
            const edgeMaterial = new THREE.LineBasicMaterial({
                color: new THREE.Color(color).multiplyScalar(1.5), // Brighter edges
                transparent: true,
                opacity: 0.9,
                linewidth: 3,
            });

            this.cachedResources[type] = {
                geometry,
                material,
                edgesGeometry,
                edgeMaterial,
            };
        });

        console.log('[ThreeJSIntroRenderer] Crystal resources cached.');
    }

    spawnInitialTetrominos() {
        // Start with 0 tetrominos - they will drift in naturally from off-screen
        // via the regular spawn timer in the update loop
    }

    /**
     * PERFORMANCE: Initialize object pools for collision effects and shooting stars
     * Pre-allocates geometry/materials to avoid per-collision GC pressure
     */
    initObjectPools() {
        // Collision effect pool - pre-create particle systems
        for (let i = 0; i < this.COLLISION_POOL_SIZE; i++) {
            const count = 8;
            const geometry = new THREE.BufferGeometry();
            const positions = new Float32Array(count * 3);
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

            const material = new THREE.PointsMaterial({
                color: 0xffffff,
                size: 0.5,
                transparent: true,
                opacity: 0,
                blending: THREE.AdditiveBlending,
            });

            const points = new THREE.Points(geometry, material);
            points.visible = false;
            points.userData = {
                velocities: Array(count).fill(null).map(() => ({ x: 0, y: 0, z: 0 })),
                life: 0,
                active: false,
            };

            this.scene.add(points);
            this.collisionEffectPool.push(points);
        }

        // Shooting star pool - pre-create trail geometries
        for (let i = 0; i < this.SHOOTING_STAR_POOL_SIZE; i++) {
            const trailLength = 15;
            const positions = new Float32Array(trailLength * 3);
            const alphas = new Float32Array(trailLength);

            for (let j = 0; j < trailLength; j++) {
                alphas[j] = 1.0 - (j / trailLength);
            }

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));

            const material = new THREE.ShaderMaterial({
                uniforms: {},
                vertexShader: `
                    attribute float alpha;
                    varying float vAlpha;
                    void main() {
                        vAlpha = alpha;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                        gl_PointSize = 3.0 * alpha;
                    }
                `,
                fragmentShader: `
                    varying float vAlpha;
                    void main() {
                        vec2 center = gl_PointCoord - vec2(0.5);
                        float dist = length(center);
                        if (dist > 0.5) discard;
                        float a = smoothstep(0.5, 0.0, dist) * vAlpha;
                        gl_FragColor = vec4(1.0, 1.0, 1.0, a);
                    }
                `,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });

            const trail = new THREE.Points(geometry, material);
            trail.visible = false;
            trail.userData = {
                velocity: new THREE.Vector3(),
                life: 0,
                trailLength,
                active: false,
            };

            this.scene.add(trail);
            this.shootingStarPool.push(trail);
        }

        console.log('[ThreeJSIntroRenderer] Object pools initialized.');
    }

    getVisibleBoundsAtDepth(depth) {
        if (!this.camera) return { width: 60, height: 40 }; // Fallback

        const dist = this.camera.position.z - depth;
        // foV is vertical field of view
        const vFOV = THREE.MathUtils.degToRad(this.camera.fov);
        const height = 2 * Math.tan(vFOV / 2) * dist;
        const width = height * this.camera.aspect;

        return { width, height };
    }

    spawnTetromino() {
        // Always spawn outside the view
        const shapeKeys = Object.keys(this.SHAPES);
        const type = shapeKeys[Math.floor(Math.random() * shapeKeys.length)];

        // Use Cached Resources
        const resources = this.cachedResources[type];
        if (!resources) {
            console.warn('Missing cached resources for type:', type);
            return;
        }

        const mesh = new THREE.Mesh(resources.geometry, resources.material);

        // Scale down the tetrominos slightly as requested
        const scale = 0.75;
        mesh.scale.set(scale, scale, scale);

        const glowOutline = new THREE.LineSegments(resources.edgesGeometry, resources.edgeMaterial);
        mesh.add(glowOutline);

        // Store some metadata for physics
        // Radius rough estimation: 4 (original max extent) * scale
        mesh.userData = {
            velocity: new THREE.Vector3(
                (Math.random() - 0.5) * 0.05, // Slower drift
                (Math.random() - 0.5) * 0.05,
                (Math.random() - 0.5) * 0.025,
            ),
            rotationSpeed: new THREE.Vector3(
                (Math.random() - 0.5) * 0.01, // Slower rotation too
                (Math.random() - 0.5) * 0.01,
                (Math.random() - 0.5) * 0.01,
            ),
            radius: 4 * scale,
            type,
        };

        // Determine Spawn Position (outside the frame at its most extreme pan).
        // The camera can drift/parallax up to `env` units from center, which
        // shifts and enlarges the visible frame; spawning beyond that envelope
        // guarantees pieces are never visible at spawn — they always drift in.
        const z = (Math.random() - 0.5) * 20 - 10; // Z range: -20 to 0
        const bounds = this.getVisibleBoundsAtDepth(z);
        const halfW = bounds.width / 2;
        const halfH = bounds.height / 2;
        const { radius } = mesh.userData;

        const envX = CAMERA_IDLE_AMP_X + (this.cameraParallax?.orbitX || 0);
        const envY = CAMERA_IDLE_AMP_Y + (this.cameraParallax?.orbitY || 0);
        const marginX = envX + radius + SPAWN_CLEARANCE;
        const marginY = envY + radius + SPAWN_CLEARANCE;
        // Along-edge span widened by the envelope so pieces also enter across the
        // corners the camera can pan to reveal.
        const spanW = bounds.width + envX * 2;
        const spanH = bounds.height + envY * 2;

        const side = Math.floor(Math.random() * 4);
        switch (side) {
        case 0: // Top
            mesh.position.set((Math.random() - 0.5) * spanW, halfH + marginY, z);
            mesh.userData.velocity.y = -Math.abs(mesh.userData.velocity.y) - SPAWN_INWARD_DRIFT; // Drift down
            break;
        case 1: // Bottom
            mesh.position.set((Math.random() - 0.5) * spanW, -halfH - marginY, z);
            mesh.userData.velocity.y = Math.abs(mesh.userData.velocity.y) + SPAWN_INWARD_DRIFT; // Drift up
            break;
        case 2: // Left
            mesh.position.set(-halfW - marginX, (Math.random() - 0.5) * spanH, z);
            mesh.userData.velocity.x = Math.abs(mesh.userData.velocity.x) + SPAWN_INWARD_DRIFT; // Drift right
            break;
        case 3: // Right
            mesh.position.set(halfW + marginX, (Math.random() - 0.5) * spanH, z);
            mesh.userData.velocity.x = -Math.abs(mesh.userData.velocity.x) - SPAWN_INWARD_DRIFT; // Drift left
            break;
        }

        this.scene.add(mesh);
        this.activeTetrominos.push(mesh);
    }

    /**
     * Creates a THREE.Shape representing the 2D contour of the tetromino.
     * Hardcoded paths to ensure perfect shapes every time.
     */
    /**
     * Creates a THREE.Shape representing the 2D contour of the tetromino.
     * Hardcoded paths using explicit centered coordinates for perfect alignment.
     * Block size = 2.0.
     */
    createTetrominoShape(type) {
        const shape = new THREE.Shape();

        switch (type) {
        case 'I':
            // [- - 0 +] (4 blocks long)
            // Width 8 (-4 to 4), Height 2 (-1 to 1)
            shape.moveTo(-4, -1);
            shape.lineTo(4, -1);
            shape.lineTo(4, 1);
            shape.lineTo(-4, 1);
            shape.lineTo(-4, -1);
            break;

        case 'O':
            // 2x2 Square
            // Width 4 (-2 to 2), Height 4 (-2 to 2)
            shape.moveTo(-2, -2);
            shape.lineTo(2, -2);
            shape.lineTo(2, 2);
            shape.lineTo(-2, 2);
            shape.lineTo(-2, -2);
            break;

        case 'T':
            //      []
            //    [][][]
            // Bottom: -3 to 3, y=-1 to 1.
            // Top: -1 to 1, y=1 to 3.
            shape.moveTo(-3, -1);
            shape.lineTo(3, -1);
            shape.lineTo(3, 1);
            shape.lineTo(1, 1);
            shape.lineTo(1, 3);
            shape.lineTo(-1, 3);
            shape.lineTo(-1, 1);
            shape.lineTo(-3, 1);
            shape.lineTo(-3, -1);
            break;

        case 'S':
            //      [][]  (Top Right)
            //    [][]    (Bottom Left)
            // Top: x=-1 to 3, y=0 to 2
            // Bottom: x=-3 to 1, y=-2 to 0
            shape.moveTo(-3, -2);
            shape.lineTo(1, -2);
            shape.lineTo(1, 0); // Inner corner
            shape.lineTo(3, 0);
            shape.lineTo(3, 2);
            shape.lineTo(-1, 2);
            shape.lineTo(-1, 0); // Inner corner
            shape.lineTo(-3, 0);
            shape.lineTo(-3, -2);
            break;

        case 'Z':
            //    [][]  (Top Left)
            //      [][]  (Bottom Right)
            // Top: x=-3 to 1, y=0 to 2
            // Bottom: x=-1 to 3, y=-2 to 0
            shape.moveTo(-1, -2);
            shape.lineTo(3, -2);
            shape.lineTo(3, 0);
            shape.lineTo(1, 0); // Inner corner
            shape.lineTo(1, 2);
            shape.lineTo(-3, 2);
            shape.lineTo(-3, 0);
            shape.lineTo(-1, 0); // Inner corner
            shape.lineTo(-1, -2);
            break;

        case 'J':
            //    []      (Top Left relative to stick?) No, J has tail left
            //    []
            //  [][]
            // Stick: x=0 to 2, y=-3 to 3
            // Tail: x=-2 to 0, y=-3 to -1
            shape.moveTo(-2, -3);
            shape.lineTo(2, -3);
            shape.lineTo(2, 3);
            shape.lineTo(0, 3);
            shape.lineTo(0, -1); // Inner corner
            shape.lineTo(-2, -1);
            shape.lineTo(-2, -3);
            break;

        case 'L':
            //      []
            //      []
            //  [][]
            // Stick: x=-2 to 0, y=-3 to 3
            // Tail: x=0 to 2, y=-3 to -1
            shape.moveTo(-2, -3);
            shape.lineTo(2, -3);
            shape.lineTo(2, -1);
            shape.lineTo(0, -1); // Inner corner
            shape.lineTo(0, 3);
            shape.lineTo(-2, 3);
            shape.lineTo(-2, -3);
            break;

        default:
            // Default box
            shape.moveTo(-2, -2);
            shape.lineTo(2, -2);
            shape.lineTo(2, 2);
            shape.lineTo(-2, 2);
            shape.lineTo(-2, -2);
            break;
        }

        return shape;
    }

    update(time) {
        if (!this.scene || !this.camera) return;

        const delta = this.clock.getDelta();

        // 1. Camera Drift — idle Lissajous sway, then pointer parallax on top.
        // apply() adds the cursor-driven offset and performs the final lookAt,
        // so it must come after the base position is set.
        const t = time * 0.2;
        this.camera.position.x = Math.sin(t * 0.5) * CAMERA_IDLE_AMP_X;
        this.camera.position.y = Math.cos(t * 0.3) * CAMERA_IDLE_AMP_Y;
        this.camera.position.z = 40;
        this.cameraParallax.apply(this.camera, delta);

        // Nebula sky drift
        if (this.nebulaSkyUniforms) {
            this.nebulaSkyUniforms.uTime.value = time;
        }

        // 2. Star field rotation
        if (this.starSystem) {
            this.starSystem.rotation.y = time * 0.02;
            this.starSystem.rotation.x = time * 0.01;
        }

        // 3. Nebula particles (Shader update)
        if (this.particles) {
            this.particles.rotation.y = -time * 0.03;
            // Update shader uniform
            if (this.particles.material.uniforms) {
                this.particles.material.uniforms.uTime.value = time;
            }
        }

        // 4. Update Tetrominos
        this.updateTetrominos(delta);

        // 5. Spawn new tetrominos
        if (time - this.lastSpawnTime > 1.5 && this.activeTetrominos.length < 25) {
            this.spawnTetromino();
            this.lastSpawnTime = time;
        }

        // 6. Update visual effects
        this.updateEffects(delta);

        // 7. Update sparkle layer
        if (this.sparkleLayer && this.sparkleLayer.material.uniforms) {
            this.sparkleLayer.material.uniforms.uTime.value = time;
        }

        // 8. Update nebula clouds
        for (const cloud of this.nebulaClouds) {
            if (cloud.material.uniforms) {
                cloud.material.uniforms.uTime.value = time;
            }
            cloud.rotation.z += cloud.userData.driftSpeed * delta;
        }

        // 9. Spawn shooting stars occasionally
        if (time - this.lastShootingStarTime > 2 + Math.random() * 3) {
            this.spawnShootingStar();
            this.lastShootingStarTime = time;
        }

        // 10. Update shooting stars
        this.updateShootingStars(delta);

        // Render with post-processing (bloom)
        if (this.composer) {
            this.composer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    updateTetrominos(delta) {
        // Simple physics step with collision detection

        // Settings
        const MAX_SPEED = INTRO_TETROMINO_MAX_SPEED;
        const RESTITUTION = 0.8; // Bounciness (1 = perfectly elastic, < 1 = loses energy)

        for (let i = this.activeTetrominos.length - 1; i >= 0; i--) {
            const t1 = this.activeTetrominos[i];

            // 1. Move
            t1.position.add(t1.userData.velocity);

            // 2. Rotate
            t1.rotation.x += t1.userData.rotationSpeed.x;
            t1.rotation.y += t1.userData.rotationSpeed.y;
            t1.rotation.z += t1.userData.rotationSpeed.z;

            // 3. No damping - let tetrominos drift at constant speed off-screen

            // 4. Bounds Check - Soft bounce off "walls" or wrap/remove
            // We'll keep the remove logic for simplicity as they drift in from outside.
            // Bounds must exceed the (camera-envelope-expanded) spawn distance so
            // far-out spawns aren't culled before they drift into view.
            if (Math.abs(t1.position.x) > 130 || Math.abs(t1.position.y) > 90 || Math.abs(t1.position.z) > 80) {
                this.scene.remove(t1);
                this.activeTetrominos.splice(i, 1);
                continue;
            }

            // 5. Collision Detection & Response
            for (let j = i + 1; j < this.activeTetrominos.length; j++) {
                const t2 = this.activeTetrominos[j];

                const dx = t1.position.x - t2.position.x;
                const dy = t1.position.y - t2.position.y;
                const dz = t1.position.z - t2.position.z;

                const distSq = dx * dx + dy * dy + dz * dz;

                // Use a slightly tighter radius for the unified meshes
                // (Geometry radius is approx 2.0-3.0 depending on shape)
                const radiussum = 3.5 + 3.5;

                if (distSq < radiussum * radiussum) {
                    const dist = Math.sqrt(distSq);

                    if (dist < 0.001) continue; // Prevent div by zero

                    // Normal vector pointing from t2 to t1
                    const nx = dx / dist;
                    const ny = dy / dist;
                    const nz = dz / dist;

                    // Relative velocity
                    const v1 = t1.userData.velocity;
                    const v2 = t2.userData.velocity;

                    const rvx = v1.x - v2.x;
                    const rvy = v1.y - v2.y;
                    const rvz = v1.z - v2.z;

                    // Velocity along normal
                    const velAlongNormal = rvx * nx + rvy * ny + rvz * nz;

                    // Do not resolve if velocities are separating
                    if (velAlongNormal > 0) continue;

                    // Calculate impulse scalar
                    // Assuming equal mass for all tetrominos for stable "billiards" feel
                    let jVal = -(1 + RESTITUTION) * velAlongNormal;
                    jVal /= 2; // (1/m1 + 1/m2) where m1=m2=1 => 2

                    // Apply impulse
                    const impulseX = jVal * nx;
                    const impulseY = jVal * ny;
                    const impulseZ = jVal * nz;

                    v1.x += impulseX;
                    v1.y += impulseY;
                    v1.z += impulseZ;

                    v2.x -= impulseX;
                    v2.y -= impulseY;
                    v2.z -= impulseZ;

                    // Add random rotation change on impact for "chaos"
                    this.perturbRotation(t1);
                    this.perturbRotation(t2);

                    // Positional Correction (prevention of sinking)
                    // Push them apart so they are not intersecting
                    const percent = 0.8; // generally 20% to 80%
                    const slop = 0.01;
                    const penetration = radiussum - dist;
                    if (penetration > slop) {
                        const correction = penetration / 2 * percent;
                        const cx = nx * correction;
                        const cy = ny * correction;
                        const cz = nz * correction;

                        t1.position.x += cx;
                        t1.position.y += cy;
                        t1.position.z += cz;

                        t2.position.x -= cx;
                        t2.position.y -= cy;
                        t2.position.z -= cz;
                    }

                    // Collision Effect
                    this.createCollisionEffect(
                        (t1.position.x + t2.position.x) * 0.5,
                        (t1.position.y + t2.position.y) * 0.5,
                        (t1.position.z + t2.position.z) * 0.5,
                    );
                }
            }

            // 6. Hard Speed Limit
            // Ensure they never "fly away" at crazy speeds
            const speedSq = t1.userData.velocity.lengthSq();
            if (speedSq > MAX_SPEED * MAX_SPEED) {
                t1.userData.velocity.setLength(MAX_SPEED);
            }
        }
    }

    perturbRotation(mesh) {
        mesh.userData.rotationSpeed.x += (Math.random() - 0.5) * 0.01;
        mesh.userData.rotationSpeed.y += (Math.random() - 0.5) * 0.01;
        mesh.userData.rotationSpeed.z += (Math.random() - 0.5) * 0.01;

        // Clamp rotation speed too
        const maxRot = 0.05;
        mesh.userData.rotationSpeed.x = Math.max(-maxRot, Math.min(maxRot, mesh.userData.rotationSpeed.x));
        mesh.userData.rotationSpeed.y = Math.max(-maxRot, Math.min(maxRot, mesh.userData.rotationSpeed.y));
        mesh.userData.rotationSpeed.z = Math.max(-maxRot, Math.min(maxRot, mesh.userData.rotationSpeed.z));
    }

    createCollisionEffect(x, y, z) {
        // PERFORMANCE: Use pooled particle system instead of creating new geometry
        const pooled = this.collisionEffectPool.find((p) => !p.userData.active);
        if (!pooled) return; // All pool items busy, skip effect

        const count = 8;
        const positions = pooled.geometry.attributes.position.array;
        const { velocities } = pooled.userData;

        for (let i = 0; i < count; i++) {
            positions[i * 3] = x;
            positions[i * 3 + 1] = y;
            positions[i * 3 + 2] = z;

            velocities[i].x = (Math.random() - 0.5) * 0.5;
            velocities[i].y = (Math.random() - 0.5) * 0.5;
            velocities[i].z = (Math.random() - 0.5) * 0.5;
        }

        pooled.geometry.attributes.position.needsUpdate = true;
        pooled.material.opacity = 1;
        pooled.userData.life = 1.0;
        pooled.userData.active = true;
        pooled.visible = true;
    }

    updateEffects(delta) {
        // PERFORMANCE: Update pooled collision effects instead of activeParticles
        for (const p of this.collisionEffectPool) {
            if (!p.userData.active) continue;

            p.userData.life -= delta * 2; // Fade out quickly

            if (p.userData.life <= 0) {
                // Return to pool instead of removing
                p.userData.active = false;
                p.visible = false;
                continue;
            }

            p.material.opacity = p.userData.life;

            const positions = p.geometry.attributes.position.array;
            const vels = p.userData.velocities;

            for (let j = 0; j < vels.length; j++) {
                positions[j * 3] += vels[j].x;
                positions[j * 3 + 1] += vels[j].y;
                positions[j * 3 + 2] += vels[j].z;
            }

            p.geometry.attributes.position.needsUpdate = true;
        }
    }

    /**
     * Update shooting stars and their trails
     * PERFORMANCE: Uses pooled shooting stars
     */
    updateShootingStars(delta) {
        for (const star of this.shootingStarPool) {
            if (!star.userData.active) continue;

            star.userData.life -= delta;

            if (star.userData.life <= 0) {
                // Return to pool instead of disposing
                star.userData.active = false;
                star.visible = false;
                continue;
            }

            // Update trail positions (shift each point, add new head position)
            const positions = star.geometry.attributes.position.array;
            const vel = star.userData.velocity;
            const { trailLength } = star.userData;

            // Shift trail points backward
            for (let j = trailLength - 1; j > 0; j--) {
                positions[j * 3] = positions[(j - 1) * 3];
                positions[j * 3 + 1] = positions[(j - 1) * 3 + 1];
                positions[j * 3 + 2] = positions[(j - 1) * 3 + 2];
            }

            // Move head position
            positions[0] += vel.x;
            positions[1] += vel.y;
            positions[2] += vel.z;

            star.geometry.attributes.position.needsUpdate = true;
        }
    }

    onResize() {
        if (!this.camera || !this.renderer) return;

        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();

        this.renderer.setSize(window.innerWidth, window.innerHeight);

        // Resize post-processing composer
        if (this.composer) {
            this.composer.setSize(window.innerWidth, window.innerHeight);
        }
        if (this.bloomPass) {
            this.bloomPass.resolution.set(window.innerWidth, window.innerHeight);
        }
    }

    /**
     * Phase F — dim the nebula backdrop behind the menu so it never competes with
     * the cards (parity with the WebGPU path). Called (optional-chained) by
     * intro-animation when entering/leaving background-only mode.
     */
    setBackgroundMode(enabled) {
        this.isBackgroundMode = !!enabled;
        if (this.nebulaSkyUniforms) {
            this.nebulaSkyUniforms.uIntensity.value = enabled ? 0.5 : 1.0;
        }
    }

    triggerTetrominoBounceAt(clientX, clientY) {
        if (!this.canvas || !this.camera || !this.raycaster || this.activeTetrominos.length === 0) {
            return false;
        }

        const ndc = getPointerNdcFromClient(this.canvas, clientX, clientY);
        if (!ndc) {
            return false;
        }

        this.scene?.updateMatrixWorld?.(true);
        this.raycaster.setFromCamera(ndc, this.camera);
        const intersections = this.raycaster.intersectObjects(this.activeTetrominos, false);
        const hit = intersections.find(({ object }) => object?.userData?.velocity);

        if (!hit) {
            return false;
        }

        const mesh = hit.object;
        const ray = toPlainRay(this.raycaster.ray);
        const impulse = computeImpulseAwayFromRay(ray, mesh.position, INTRO_TETROMINO_CLICK_IMPULSE);
        const velocity = clampVectorMagnitude({
            x: mesh.userData.velocity.x + impulse.x,
            y: mesh.userData.velocity.y + impulse.y,
            z: mesh.userData.velocity.z + impulse.z,
        }, INTRO_TETROMINO_MAX_SPEED);

        mesh.userData.velocity.set(velocity.x, velocity.y, velocity.z);
        this.perturbRotation(mesh);
        this.createCollisionEffect(hit.point.x, hit.point.y, hit.point.z);

        return true;
    }

    destroy() {
        window.removeEventListener('resize', this.boundResizeHandler);
        this.cameraParallax?.detach();

        if (this.nebulaSky) {
            this.nebulaSky.geometry?.dispose();
            this.nebulaSky.material?.dispose();
            this.nebulaSky = null;
            this.nebulaSkyUniforms = null;
        }

        // Clean up geometries and materials
        // (Simplified cleanup for intro duration)
        if (this.scene) {
            this.scene.clear();
        }

        if (this.composer) {
            this.composer.dispose();
            this.composer = null;
        }

        if (this.renderer) {
            this.renderer.dispose();
        }

        this.activeTetrominos = [];
        this.activeParticles = [];
    }
}
