/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SINGING BOWL THEME - Recursive Tree Cubes with Reflection
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Based on oosmoxiecode's Recursive Tree Cubes and Three.js webgpu_reflection
 * Features:
 * - Instanced cubes for performance
 * - Time-based color cycling shader
 * - Transformative animation with spreading/rotating cubes
 * - Reflective ground plane
 * - Atmospheric bloom
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { SINGING_BOWL_TETROMINOS } from './singing-bowl-tetrominos.js';

// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets
// ─────────────────────────────────────────────────────────────────────────────
const QUALITY_PRESETS = {
    Extreme: { maxCubes: 6000, treeDepth: 8, bloomStrength: 0.35, bloomRadius: 0.4, enablePost: true, reflectorRes: 512, skyParticles: 1000 },
    Ultra: { maxCubes: 5000, treeDepth: 7, bloomStrength: 0.3, bloomRadius: 0.35, enablePost: true, reflectorRes: 512, skyParticles: 900 },
    High: { maxCubes: 4000, treeDepth: 7, bloomStrength: 0.25, bloomRadius: 0.3, enablePost: true, reflectorRes: 256, skyParticles: 800 },
    Medium: { maxCubes: 2500, treeDepth: 6, bloomStrength: 0.2, bloomRadius: 0.2, enablePost: false, reflectorRes: 256, skyParticles: 500 },
    Low: { maxCubes: 1500, treeDepth: 5, bloomStrength: 0.15, bloomRadius: 0.15, enablePost: false, reflectorRes: 128, skyParticles: 300 },
    Minimal: { maxCubes: 800, treeDepth: 4, bloomStrength: 0.1, bloomRadius: 0.1, enablePost: false, reflectorRes: 128, skyParticles: 150 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Cube Shader with Blue/Teal Palette (matching screenshot)
// ─────────────────────────────────────────────────────────────────────────────
const CubeShader = {
    vertexShader: `
        attribute vec3 instanceColor;
        attribute float instanceDepth;
        
        varying vec3 vColor;
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        varying float vDepth;
        
        void main() {
            vColor = instanceColor;
            vNormal = normalMatrix * normal;
            vDepth = instanceDepth;
            
            vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
            vWorldPos = worldPos.xyz;
            
            gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
    `,
    fragmentShader: `
        uniform float uTime;
        uniform float uPulseIntensity;
        
        varying vec3 vColor;
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        varying float vDepth;
        
        // HSV to RGB conversion
        vec3 hsv2rgb(vec3 c) {
            vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
            vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
            return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
        }
        
        void main() {
            // RAINBOW COLOR CYCLING (oosmoxiecode style)
            // Cycle hue continuously based on time and vertical position/depth
            float hue = fract(uTime * 0.15 + vDepth * 0.1 + vWorldPos.y * 0.05);
            
            // Saturation increases with pulse
            float sat = 0.6 + uPulseIntensity * 0.4;
            
            // Value (brightness) pulses
            float val = 0.8 + uPulseIntensity * 0.5;
            
            vec3 rainbowColor = hsv2rgb(vec3(hue, sat, val));
            
            // Simple lighting
            vec3 lightDir = normalize(vec3(0.5, 1.0, 0.5));
            float diff = max(dot(vNormal, lightDir), 0.0) * 0.6 + 0.4;
            
            // Fresnel edge glow
            vec3 viewDir = normalize(cameraPosition - vWorldPos);
            float fresnel = pow(1.0 - max(dot(viewDir, vNormal), 0.0), 3.0);
            
            vec3 finalColor = rainbowColor * diff;
            finalColor += rainbowColor * fresnel * 0.5; // Glowing edges
            // Removed extra emissive/white flash to prevent washout
            
            gl_FragColor = vec4(finalColor, 1.0);
        }
    `
};

// ─────────────────────────────────────────────────────────────────────────────
// Theme Class
// ─────────────────────────────────────────────────────────────────────────────

export default class SingingBowlTheme extends BaseTheme {
    constructor() {
        super('singing-bowl');
        this.eventUnsubscribers = [];

        // Three.js components
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.composer = null;
        this.treeGroup = null;
        this.reflector = null;
        this.instancedMesh = null;
        this.cubeMaterial = null;

        // Cube data for animation
        this.cubeData = [];
        this.instanceCount = 0;
        this.orbs = [];
        this.rings = [];
        this.floorUniforms = null;
        this.skyParticles = null;

        // Animation
        this.animationFrame = null;
        this.clock = new THREE.Clock();

        // State
        this.uniforms = {
            uTime: { value: 0 },
            uPulseIntensity: { value: 0 },
        };

        this.currentQuality = 'High';
        this.activePreset = QUALITY_PRESETS.High;
    }

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    async createScene() {
        console.log('[SingingBowl] Initializing Recursive Tree Cubes...');

        const container = document.getElementById('singing-bowl-theme');
        if (!container) {
            console.error('[SingingBowl] Container not found');
            return;
        }

        // Set quality
        const quality = this.getGraphicsQuality();
        this.activePreset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.High;
        this.currentQuality = quality;

        // Clean up existing content
        container.innerHTML = '';

        // Scene setup - Deep Teal/Blue atmosphere
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x001018); // Deep teal dark
        this.scene.fog = new THREE.FogExp2(0x001525, 0.015); // Matching fog

        // Camera
        this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
        this.camera.position.set(0, 5, 15);
        this.camera.lookAt(0, 3, 0);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            powerPreference: 'high-performance',
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 0.7; // Lower exposure to prevent white washout
        container.appendChild(this.renderer.domElement);

        // Post-processing with bloom
        if (this.activePreset.enablePost) {
            this.composer = new EffectComposer(this.renderer);
            this.composer.addPass(new RenderPass(this.scene, this.camera));

            const bloomPass = new UnrealBloomPass(
                new THREE.Vector2(window.innerWidth, window.innerHeight),
                this.activePreset.bloomStrength,
                this.activePreset.bloomRadius,
                0.85
            );
            this.composer.addPass(bloomPass);
            this.bloomPass = bloomPass;
        }

        // Create scene elements
        this.createReflectorGround();
        this.createInstancedTree();
        this.createCrystalSpires();
        this.createRingFormations();
        this.createBillboardSky();
        this.createExplosionSystem();
        this.setupLighting();

        // Event listeners
        this.setupEventListeners();
        this.boundOnResize = this.onWindowResize.bind(this);
        window.addEventListener('resize', this.boundOnResize);

        // Start animation
        this.animate();

        console.log('[SingingBowl] Recursive Tree Cubes initialized with', this.instanceCount, 'cubes');
    }

    createReflectorGround() {
        // 1. Base Reflector (Mirror) - reduced size for performance
        const groundGeo = new THREE.PlaneGeometry(60, 60);
        this.reflector = new Reflector(groundGeo, {
            clipBias: 0.003,
            textureWidth: this.activePreset.reflectorRes,
            textureHeight: this.activePreset.reflectorRes,
            color: 0x080820,
        });
        this.reflector.rotation.x = -Math.PI / 2;
        this.reflector.position.y = -0.01;
        this.scene.add(this.reflector);

        // 2. Simplified Animated Pixelated Overlay
        const pixelFloorShader = {
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                varying vec2 vUv;
                
                vec3 hsv2rgb(vec3 c) {
                    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
                    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
                    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
                }
                
                void main() {
                    // Larger pixels = faster rendering
                    float pixelSize = 0.04;
                    vec2 uv = floor(vUv / pixelSize) * pixelSize;
                    
                    // Simplified wave
                    vec2 flowUv = uv + vec2(sin(uv.x * 6.0 + uTime * 0.4), cos(uv.y * 5.0 + uTime * 0.3)) * 0.015;
                    float dist = length(flowUv - 0.5);
                    
                    // Rainbow cycling
                    float hue = fract(uTime * 0.08 + dist * 0.4 + uv.x * 0.5);
                    vec3 color = hsv2rgb(vec3(hue, 0.6, 0.25));
                    
                    // Radial fade - soft edges that blend to black
                    float edgeFade = 1.0 - smoothstep(0.3, 0.5, dist);
                    
                    gl_FragColor = vec4(color, 0.4 * edgeFade);
                }
            `
        };

        this.floorUniforms = { uTime: { value: 0 } };
        const overlayGeo = new THREE.PlaneGeometry(60, 60);
        const overlayMat = new THREE.ShaderMaterial({
            uniforms: this.floorUniforms,
            vertexShader: pixelFloorShader.vertexShader,
            fragmentShader: pixelFloorShader.fragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
        });

        const overlay = new THREE.Mesh(overlayGeo, overlayMat);
        overlay.rotation.x = -Math.PI / 2;
        overlay.position.y = 0.01;
        this.scene.add(overlay);
    }

    createCrystalSpires() {
        const spireData = [
            { pos: new THREE.Vector3(-20, 0, -15), height: 8, segments: 6 },
            { pos: new THREE.Vector3(18, 0, -12), height: 9, segments: 4 },
            { pos: new THREE.Vector3(-25, 0, 5), height: 8, segments: 4 },
        ];

        spireData.forEach((spire, idx) => {
            const geo = new THREE.ConeGeometry(0.8, spire.height, spire.segments);
            const mat = new THREE.ShaderMaterial({
                uniforms: this.uniforms,
                vertexShader: `
                    varying vec3 vPos; varying vec3 vNormal;
                    void main() {
                        vPos = position; vNormal = normalMatrix * normal;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform float uTime;
                    varying vec3 vPos; varying vec3 vNormal;
                    vec3 hsv2rgb(vec3 c) {
                        vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
                        vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
                        return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
                    }
                    void main() {
                        float hue = fract(uTime * 0.15 + vPos.y * 0.1 + ${idx * 0.15});
                        vec3 col = hsv2rgb(vec3(hue, 0.7, 0.9));
                        float fresnel = pow(1.0 - abs(dot(normalize(vNormal), vec3(0,0,1))), 2.0);
                        gl_FragColor = vec4(col + fresnel * 0.3, 1.0);
                    }
                `,
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.copy(spire.pos);
            mesh.position.y = spire.height / 2;
            this.scene.add(mesh);
        });
    }

    createFloatingOrbs() {
        const orbData = [
            { pos: new THREE.Vector3(-15, 6, -10), radius: 1.2 },
            { pos: new THREE.Vector3(15, 8, -8), radius: 1.5 },
            { pos: new THREE.Vector3(0, 12, -5), radius: 1.0 },
            { pos: new THREE.Vector3(-22, 5, 0), radius: 0.8 },
            { pos: new THREE.Vector3(22, 7, -3), radius: 1.1 },
        ];

        this.orbs = [];
        orbData.forEach((orb, idx) => {
            const geo = new THREE.IcosahedronGeometry(orb.radius, 2);
            const mat = new THREE.ShaderMaterial({
                uniforms: this.uniforms,
                vertexShader: `
                    varying vec3 vPos; varying vec3 vNormal;
                    void main() {
                        vPos = position; vNormal = normalMatrix * normal;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform float uTime;
                    varying vec3 vPos; varying vec3 vNormal;
                    vec3 hsv2rgb(vec3 c) {
                        vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
                        vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
                        return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
                    }
                    void main() {
                        float hue = fract(uTime * 0.2 + length(vPos) * 0.15 + ${idx * 0.2});
                        vec3 col = hsv2rgb(vec3(hue, 0.6, 0.95));
                        float fresnel = pow(1.0 - abs(dot(normalize(vNormal), vec3(0,0,1))), 3.0);
                        gl_FragColor = vec4(col + fresnel * 0.5, 1.0);
                    }
                `,
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.copy(orb.pos);
            mesh.userData.baseY = orb.pos.y;
            mesh.userData.phase = idx * 0.7;
            this.orbs.push(mesh);
            this.scene.add(mesh);
        });
    }

    createRingFormations() {
        const ringData = [
            { pos: new THREE.Vector3(0, 3, 0), radius: 5, tube: 0.15 },
            { pos: new THREE.Vector3(-12, 2, -8), radius: 3.5, tube: 0.12 },
            { pos: new THREE.Vector3(12, 2, -8), radius: 3.5, tube: 0.12 },
        ];

        this.rings = [];
        ringData.forEach((ring, idx) => {
            const geo = new THREE.TorusGeometry(ring.radius, ring.tube, 8, 24);
            const mat = new THREE.ShaderMaterial({
                uniforms: this.uniforms,
                vertexShader: `
                    varying vec3 vPos;
                    void main() {
                        vPos = position;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform float uTime;
                    varying vec3 vPos;
                    vec3 hsv2rgb(vec3 c) {
                        vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
                        vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
                        return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
                    }
                    void main() {
                        float angle = atan(vPos.z, vPos.x);
                        float hue = fract(uTime * 0.25 + angle * 0.16 + ${idx * 0.33});
                        vec3 col = hsv2rgb(vec3(hue, 0.7, 0.85));
                        gl_FragColor = vec4(col, 1.0);
                    }
                `,
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.copy(ring.pos);
            mesh.rotation.x = Math.PI / 2;
            mesh.userData.rotSpeed = 0.2 + idx * 0.1;
            this.rings.push(mesh);
            this.scene.add(mesh);
        });
    }

    createBillboardSky() {
        // Instanced billboard particles for pulsing sky effect
        const particleCount = this.activePreset.skyParticles || 300;

        // Billboard geometry (simple quad)
        const geometry = new THREE.InstancedBufferGeometry();

        // Base quad vertices
        const vertices = new Float32Array([
            -0.5, -0.5, 0,
            0.5, -0.5, 0,
            0.5, 0.5, 0,
            -0.5, 0.5, 0
        ]);

        const uvs = new Float32Array([
            0, 0,
            1, 0,
            1, 1,
            0, 1
        ]);

        const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));

        // Instance attributes
        const offsets = new Float32Array(particleCount * 3);
        const scales = new Float32Array(particleCount);
        const colors = new Float32Array(particleCount * 3);
        const phases = new Float32Array(particleCount);

        for (let i = 0; i < particleCount; i++) {
            // Distribute particles across full sky dome, including lower areas
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.random() * Math.PI * 0.7; // Wider angle - more of the hemisphere
            const radius = 30 + Math.random() * 40;

            offsets[i * 3] = Math.sin(phi) * Math.cos(theta) * radius;
            offsets[i * 3 + 1] = Math.cos(phi) * radius * 0.5 + 5; // Lower minimum height
            offsets[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * radius;

            scales[i] = 0.5 + Math.random() * 2.0;
            phases[i] = Math.random() * Math.PI * 2;

            // Initial hue distributed across spectrum
            const hue = i / particleCount;
            colors[i * 3] = hue;
            colors[i * 3 + 1] = 0.7; // saturation
            colors[i * 3 + 2] = 0.8; // value
        }

        geometry.setAttribute('offset', new THREE.InstancedBufferAttribute(offsets, 3));
        geometry.setAttribute('scale', new THREE.InstancedBufferAttribute(scales, 1));
        geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3));
        geometry.setAttribute('phase', new THREE.InstancedBufferAttribute(phases, 1));

        // Billboard shader material
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.uTime,
                uPulseIntensity: this.uniforms.uPulseIntensity,
            },
            vertexShader: `
                uniform float uPulseIntensity;
                
                attribute vec3 offset;
                attribute float scale;
                attribute vec3 aColor;
                attribute float phase;
                
                varying vec3 vColor;
                varying vec2 vUv;
                varying float vPhase;
                
                void main() {
                    vColor = aColor;
                    vUv = uv;
                    vPhase = phase;
                    
                    // Billboard: always face camera
                    vec3 cameraRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
                    vec3 cameraUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
                    
                    // Pulse scale effect - particles grow on pulse
                    float pulseScale = scale * (1.0 + uPulseIntensity * 1.5);
                    
                    vec3 vertexPosition = offset + 
                        cameraRight * position.x * pulseScale +
                        cameraUp * position.y * pulseScale;
                    
                    gl_Position = projectionMatrix * viewMatrix * vec4(vertexPosition, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform float uPulseIntensity;
                
                varying vec3 vColor;
                varying vec2 vUv;
                varying float vPhase;
                
                vec3 hsv2rgb(vec3 c) {
                    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
                    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
                    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
                }
                
                void main() {
                    // Circular soft particle
                    vec2 center = vUv - 0.5;
                    float dist = length(center);
                    float alpha = 1.0 - smoothstep(0.3, 0.5, dist);
                    
                    // Pulsing hue cycle - faster shift on pulse
                    float hue = fract(vColor.x + uTime * 0.15 + sin(uTime * 2.0 + vPhase) * 0.1 + uPulseIntensity * 0.3);
                    float sat = vColor.y + uPulseIntensity * 0.3;
                    float val = vColor.z + sin(uTime * 3.0 + vPhase) * 0.2 + uPulseIntensity * 0.8;
                    
                    vec3 color = hsv2rgb(vec3(hue, sat, val));
                    
                    // Glow effect - stronger on pulse
                    float glow = 1.0 - smoothstep(0.0, 0.5, dist);
                    color += color * glow * (0.5 + uPulseIntensity * 1.5);
                    
                    // Alpha boost on pulse
                    float pulseAlpha = alpha * (0.6 + uPulseIntensity * 0.8);
                    
                    gl_FragColor = vec4(color, pulseAlpha);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.skyParticles = new THREE.Mesh(geometry, material);
        this.scene.add(this.skyParticles);
    }

    createExplosionSystem() {
        // Explosion particles pool for combo effects
        const maxParticles = 300;

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(maxParticles * 3);
        const velocities = new Float32Array(maxParticles * 3);
        const colors = new Float32Array(maxParticles * 3);
        const sizes = new Float32Array(maxParticles);
        const lifetimes = new Float32Array(maxParticles);

        // Initialize all particles as inactive
        for (let i = 0; i < maxParticles; i++) {
            positions[i * 3] = 0;
            positions[i * 3 + 1] = -1000; // Hidden below scene
            positions[i * 3 + 2] = 0;
            velocities[i * 3] = 0;
            velocities[i * 3 + 1] = 0;
            velocities[i * 3 + 2] = 0;
            colors[i * 3] = 1;
            colors[i * 3 + 1] = 1;
            colors[i * 3 + 2] = 1;
            sizes[i] = 0;
            lifetimes[i] = 0;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('lifetime', new THREE.BufferAttribute(lifetimes, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.uTime,
            },
            vertexShader: `
                attribute float size;
                attribute vec3 color;
                attribute float lifetime;
                
                varying vec3 vColor;
                varying float vLifetime;
                
                void main() {
                    vColor = color;
                    vLifetime = lifetime;
                    
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = size * (300.0 / -mvPosition.z);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                varying float vLifetime;
                
                void main() {
                    // Square pixels - no distance check needed
                    vec2 coord = abs(gl_PointCoord - 0.5);
                    float edgeDist = max(coord.x, coord.y);
                    
                    // Sharp square edge with slight inner fade
                    float alpha = vLifetime * smoothstep(0.5, 0.4, edgeDist);
                    gl_FragColor = vec4(vColor, alpha);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.explosionParticles = new THREE.Points(geometry, material);
        this.explosionParticles.frustumCulled = false;
        this.scene.add(this.explosionParticles);

        this.explosionData = {
            positions,
            velocities,
            colors,
            sizes,
            lifetimes,
            maxParticles,
            nextParticle: 0,
        };
    }

    triggerExplosion(comboCount) {
        if (!this.explosionData) return;

        const { positions, velocities, colors, sizes, lifetimes, maxParticles } = this.explosionData;
        const particlesToSpawn = Math.min(50 + comboCount * 30, 150);

        // Tree canopy centers for explosion origins
        const origins = [
            new THREE.Vector3(0, 8, 0),      // Main tree top
            new THREE.Vector3(-12, 6, -8),   // Left tree
            new THREE.Vector3(12, 6, -8),    // Right tree
        ];

        for (let i = 0; i < particlesToSpawn; i++) {
            const idx = (this.explosionData.nextParticle + i) % maxParticles;

            // Random origin from tree canopies
            const origin = origins[Math.floor(Math.random() * origins.length)];

            // Spread from origin
            positions[idx * 3] = origin.x + (Math.random() - 0.5) * 4;
            positions[idx * 3 + 1] = origin.y + Math.random() * 3;
            positions[idx * 3 + 2] = origin.z + (Math.random() - 0.5) * 4;

            // Explosive velocity - outward and upward
            const angle = Math.random() * Math.PI * 2;
            const speed = 15 + Math.random() * 20;
            velocities[idx * 3] = Math.cos(angle) * speed;
            velocities[idx * 3 + 1] = 5 + Math.random() * 15;
            velocities[idx * 3 + 2] = Math.sin(angle) * speed;

            // Rainbow colors
            const hue = Math.random();
            const rgb = this.hsvToRgb(hue, 0.8, 1.0);
            colors[idx * 3] = rgb.r;
            colors[idx * 3 + 1] = rgb.g;
            colors[idx * 3 + 2] = rgb.b;

            sizes[idx] = 2 + Math.random() * 4;
            lifetimes[idx] = 1.0;
        }

        this.explosionData.nextParticle = (this.explosionData.nextParticle + particlesToSpawn) % maxParticles;

        // Update attributes
        this.explosionParticles.geometry.attributes.position.needsUpdate = true;
        this.explosionParticles.geometry.attributes.velocity.needsUpdate = true;
        this.explosionParticles.geometry.attributes.color.needsUpdate = true;
        this.explosionParticles.geometry.attributes.size.needsUpdate = true;
        this.explosionParticles.geometry.attributes.lifetime.needsUpdate = true;
    }

    hsvToRgb(h, s, v) {
        let r, g, b;
        const i = Math.floor(h * 6);
        const f = h * 6 - i;
        const p = v * (1 - s);
        const q = v * (1 - f * s);
        const t = v * (1 - (1 - f) * s);
        switch (i % 6) {
            case 0: r = v; g = t; b = p; break;
            case 1: r = q; g = v; b = p; break;
            case 2: r = p; g = v; b = t; break;
            case 3: r = p; g = q; b = v; break;
            case 4: r = t; g = p; b = v; break;
            case 5: r = v; g = p; b = q; break;
        }
        return { r, g, b };
    }

    updateExplosionParticles(deltaTime) {
        if (!this.explosionData) return;

        const { positions, velocities, lifetimes, maxParticles } = this.explosionData;
        const gravity = -25;

        for (let i = 0; i < maxParticles; i++) {
            if (lifetimes[i] > 0) {
                // Update position
                positions[i * 3] += velocities[i * 3] * deltaTime;
                positions[i * 3 + 1] += velocities[i * 3 + 1] * deltaTime;
                positions[i * 3 + 2] += velocities[i * 3 + 2] * deltaTime;

                // Apply gravity
                velocities[i * 3 + 1] += gravity * deltaTime;

                // Decay lifetime
                lifetimes[i] -= deltaTime * 0.8;

                if (lifetimes[i] <= 0) {
                    positions[i * 3 + 1] = -1000; // Hide
                }
            }
        }

        this.explosionParticles.geometry.attributes.position.needsUpdate = true;
        this.explosionParticles.geometry.attributes.lifetime.needsUpdate = true;
    }

    createInstancedTree() {
        this.cubeData = [];

        // 1. Center Tree (Main)
        this.generateTreeData(
            new THREE.Vector3(0, 0, 0),
            new THREE.Quaternion(),
            3.0, 0, this.activePreset.treeDepth
        );

        // 2. Left Tree (Smaller, rotated)
        const leftRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
        this.generateTreeData(
            new THREE.Vector3(-12, -1, -8),
            leftRot,
            2.5, 0, this.activePreset.treeDepth - 1
        );

        // 3. Right Tree (Smaller, rotated opposite)
        const rightRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 3);
        this.generateTreeData(
            new THREE.Vector3(12, -1, -8),
            rightRot,
            2.5, 0, this.activePreset.treeDepth - 1
        );

        this.instanceCount = Math.min(this.cubeData.length, this.activePreset.maxCubes * 2); // Allow more cubes
        console.log('[SingingBowl] Generated', this.cubeData.length, 'cubes, using', this.instanceCount);

        // Create instanced mesh
        const geometry = new THREE.BoxGeometry(1, 1, 1);

        // Create shader material with color cycling
        this.cubeMaterial = new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            vertexShader: CubeShader.vertexShader,
            fragmentShader: CubeShader.fragmentShader,
        });

        this.instancedMesh = new THREE.InstancedMesh(geometry, this.cubeMaterial, this.instanceCount);
        this.instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

        // Add instance attributes for depth
        const instanceDepths = new Float32Array(this.instanceCount);
        const instanceColors = new Float32Array(this.instanceCount * 3);

        for (let i = 0; i < this.instanceCount; i++) {
            const data = this.cubeData[i];
            instanceDepths[i] = data.depth;
            // Initial colors (will be overridden by shader)
            instanceColors[i * 3] = 0.3;
            instanceColors[i * 3 + 1] = 0.5;
            instanceColors[i * 3 + 2] = 1.0;
        }

        geometry.setAttribute('instanceDepth', new THREE.InstancedBufferAttribute(instanceDepths, 1));
        geometry.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(instanceColors, 3));

        // Set initial matrices
        this.updateInstanceMatrices(0);

        this.scene.add(this.instancedMesh);
    }

    generateTreeData(position, rotation, size, depth, maxDepth) {
        if (depth >= maxDepth || size < 0.05) return;

        // Store cube data with full orientation
        this.cubeData.push({
            basePosition: position.clone(),
            baseRotation: rotation.clone(), // Store quaternion
            size: size,
            depth: depth,
            animPhase: Math.random() * Math.PI * 2,
        });

        // Generate children - true 3D branching
        const numBranches = 3;
        const childSize = size * 0.75; // Slower decay for bigger structure

        // Calculate "Up" vector in current orientation (where this branch points)
        const localUp = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation);

        // End of current branch (start of next)
        const branchEnd = position.clone().add(localUp.multiplyScalar(size));

        for (let i = 0; i < numBranches; i++) {
            // distribute branches around the up axis
            const angleAround = (i / numBranches) * Math.PI * 2;
            // angle OUT from the main axis (spreading)
            const spreadAngle = 0.5 + Math.random() * 0.3; // 0.5-0.8 rads spread

            // Create rotations
            const rotSpread = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), spreadAngle);
            const rotSpin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angleAround);

            // Combine: Spin then Spread relative to local frame? 
            // Actually: We want to rotate the current frame geometry.

            // Child orientation: ParentRot * Spin * Spread
            const childRotation = rotation.clone().multiply(rotSpin).multiply(rotSpread);

            this.generateTreeData(branchEnd, childRotation, childSize, depth + 1, maxDepth);
        }
    }

    updateInstanceMatrices(time) {
        const matrix = new THREE.Matrix4();
        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        const scale = new THREE.Vector3();

        for (let i = 0; i < this.instanceCount; i++) {
            const data = this.cubeData[i];

            // Animated transformation
            // 1. Position: Base position (static in fractal structure)
            // But we can add "breathing" or "sway" to the whole tree data structure or here.

            // Note: Since basePosition is absolute world coord from generation, 
            // simple shader animation is safest to avoid breaking the tree connectivity.
            // But for "Recursive Tree Cubes" effect, the cubes usually rotate in place AND carry children.
            // Since we pre-calculated positions, we can't easily rotate parents and have children follow 
            // unless we re-calculate positions every frame (expensive for JS).

            // For this technique (InstancedMesh), we usually just animate individual cubes 
            // in place, like pulsing, or minor local rotations. 
            // The Oosmoxiecode demo DOES re-calculate hierarchy or uses a shader to propagate transforms.
            // Given JS performance limits, let's Stick to the static structure we just built
            // and animate local "spin" and "pulse" and "sway".

            position.copy(data.basePosition);

            // Sway effect based on height/depth
            const sway = Math.sin(time * 0.5 + data.basePosition.y * 0.2) * (data.basePosition.y * 0.05);
            position.x += sway; // Simple wind sway

            // Visual Orientation
            // Combine base structural rotation with animation
            quaternion.copy(data.baseRotation);

            // Add local spin?
            const localSpin = new THREE.Quaternion();
            // Rotate around its own local Y axis
            localSpin.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.sin(time + data.depth) * 0.1);
            quaternion.multiply(localSpin);

            // Pulse Scale
            // Cubes near tips pulse faster?
            const pulsePhase = time * 2.0 + data.depth * 0.5 + data.animPhase;
            const pulseAmount = 1.0 + Math.sin(pulsePhase) * 0.1;
            const gameplayPulse = 1.0 + this.uniforms.uPulseIntensity.value * 0.3;

            scale.setScalar(data.size * pulseAmount * gameplayPulse);

            matrix.compose(position, quaternion, scale);
            this.instancedMesh.setMatrixAt(i, matrix);
        }

        this.instancedMesh.instanceMatrix.needsUpdate = true;
    }

    setupLighting() {
        // Ambient light
        const ambient = new THREE.AmbientLight(0x101020, 0.4);
        this.scene.add(ambient);

        // Main directional light
        const mainLight = new THREE.DirectionalLight(0xffffff, 0.5); // Reduced from 0.8
        mainLight.position.set(5, 10, 5);
        this.scene.add(mainLight);

        // Secondary light for depth
        const fillLight = new THREE.DirectionalLight(0x4060ff, 0.3); // Reduced from 0.4
        fillLight.position.set(-5, 5, -5);
        this.scene.add(fillLight);

        // Point light near tree center
        const centerLight = new THREE.PointLight(0x4080ff, 0.5, 20); // Reduced from 0.8
        centerLight.position.set(0, 4, 0);
        this.scene.add(centerLight);
        this.centerLight = centerLight;
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

    onPieceLock() {
        // Subtle pulse on piece lock
        this.uniforms.uPulseIntensity.value = 0.10;
    }

    onLineClear(lineCount) {
        this.uniforms.uPulseIntensity.value = 0.5 + lineCount * 0.15;
        if (this.bloomPass && lineCount >= 2) {
            this.bloomPass.strength = this.activePreset.bloomStrength + lineCount * 0.1;
        }
    }

    onCombo(comboCount) {
        // Moderate pulse for trees during combo - balanced brightness
        this.uniforms.uPulseIntensity.value = Math.min(0.9, 0.5 + comboCount * 0.15);
        if (this.centerLight) {
            this.centerLight.intensity = 0.7 + comboCount * 0.2;
        }
        if (this.bloomPass) {
            this.bloomPass.strength = this.activePreset.bloomStrength + comboCount * 0.06;
        }
        // Trigger explosion from tree canopies
        this.triggerExplosion(comboCount);
    }

    animate() {
        if (!this.isActive) return;

        this.animationFrame = requestAnimationFrame(this.animate.bind(this));

        const deltaTime = this.clock.getDelta();
        const elapsed = this.clock.elapsedTime;
        this.uniforms.uTime.value = elapsed;

        // Update all cube positions and rotations
        if (this.instancedMesh) {
            this.updateInstanceMatrices(elapsed);
        }

        // Update floor shader time
        if (this.floorUniforms) {
            this.floorUniforms.uTime.value = elapsed;
        }

        // Animate floating orbs
        if (this.orbs) {
            this.orbs.forEach((orb) => {
                orb.position.y = orb.userData.baseY + Math.sin(elapsed * 0.8 + orb.userData.phase) * 0.5;
                orb.rotation.y = elapsed * 0.3 + orb.userData.phase;
            });
        }

        // Animate rings
        if (this.rings) {
            this.rings.forEach((ring) => {
                ring.rotation.z = elapsed * ring.userData.rotSpeed;
            });
        }

        // Update explosion particles
        this.updateExplosionParticles(deltaTime);

        // ORBITAL camera movement - circles around the tree
        const cameraRadius = 25;  // Further back to see all trees
        const cameraHeight = 10 + Math.sin(elapsed * 0.2) * 3;
        const cameraAngle = elapsed * 0.12;  // Slow orbit

        this.camera.position.x = Math.sin(cameraAngle) * cameraRadius;
        this.camera.position.z = Math.cos(cameraAngle) * cameraRadius;
        this.camera.position.y = cameraHeight;

        // Look at center of MAIN tree, higher up
        this.camera.lookAt(0, 6, 0);

        // Decay effects
        if (this.uniforms.uPulseIntensity.value > 0) {
            this.uniforms.uPulseIntensity.value *= 0.95;
        }

        // Decay center light
        if (this.centerLight && this.centerLight.intensity > 0.8) {
            this.centerLight.intensity *= 0.97;
        }

        // Decay bloom
        if (this.bloomPass && this.bloomPass.strength > this.activePreset.bloomStrength) {
            this.bloomPass.strength *= 0.98;
        }

        // Render
        if (this.composer) {
            this.composer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
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
        console.log('[SingingBowl] Stopping theme...');

        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }

        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];

        if (this.boundOnResize) {
            window.removeEventListener('resize', this.boundOnResize);
        }

        // Cleanup Three.js
        if (this.renderer) {
            this.renderer.dispose();
            const container = document.getElementById('singing-bowl-theme');
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

        // Clear references
        this.cubeData = [];
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.composer = null;
        this.treeGroup = null;
        this.reflector = null;
        this.instancedMesh = null;
        this.cubeMaterial = null;
        this.bloomPass = null;

        super.stop();
    }

    getTetrominoConfig() {
        return SINGING_BOWL_TETROMINOS;
    }
}
