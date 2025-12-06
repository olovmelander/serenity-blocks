/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ✧ CHROMADELIC HIGHWAY ✧
 *  A Psychedelic Rainbow Road Theme - Dynamic Infinite Road
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Rebuilt with a dynamic approach:
 * - Camera travels forward along an ever-changing path
 * - Road curve dynamically shifts and undulates
 * - Rings centered and synchronized with road direction
 * - Cohesive visual experience with depth layering
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { normalizeQuality } from '../../utils/quality.js';
import { CHROMADELIC_HIGHWAY_TETROMINOS } from './chromadelic-highway-tetrominos.js';

// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets
// ─────────────────────────────────────────────────────────────────────────────
const QUALITY_PRESETS = {
    Extreme: {
        starCount: 2000,
        ringCount: 8,
        speedParticleCount: 300,
        roadSegments: 120,
        bloomStrength: 0.5,
        bloomRadius: 0.3,
        bloomThreshold: 0.65,
        enableBloom: true,
    },
    Ultra: {
        starCount: 1500,
        ringCount: 7,
        speedParticleCount: 250,
        roadSegments: 100,
        bloomStrength: 0.45,
        bloomRadius: 0.25,
        bloomThreshold: 0.7,
        enableBloom: true,
    },
    High: {
        starCount: 1200,
        ringCount: 6,
        speedParticleCount: 200,
        roadSegments: 80,
        bloomStrength: 0.4,
        bloomRadius: 0.2,
        bloomThreshold: 0.75,
        enableBloom: true,
    },
    Medium: {
        starCount: 800,
        ringCount: 5,
        speedParticleCount: 150,
        roadSegments: 60,
        bloomStrength: 0.35,
        bloomRadius: 0.2,
        bloomThreshold: 0.8,
        enableBloom: true,
    },
    Low: {
        starCount: 400,
        ringCount: 4,
        speedParticleCount: 80,
        roadSegments: 40,
        bloomStrength: 0.3,
        bloomRadius: 0.15,
        bloomThreshold: 0.85,
        enableBloom: false,
    },
    Minimal: {
        starCount: 200,
        ringCount: 3,
        speedParticleCount: 40,
        roadSegments: 30,
        bloomStrength: 0.2,
        bloomRadius: 0.1,
        bloomThreshold: 0.9,
        enableBloom: false,
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Vignette Shader
// ─────────────────────────────────────────────────────────────────────────────
const VignetteShader = {
    uniforms: {
        tDiffuse: { value: null },
        darkness: { value: 0.5 },
        offset: { value: 1.0 },
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float darkness;
        uniform float offset;
        varying vec2 vUv;
        
        void main() {
            vec4 texel = texture2D(tDiffuse, vUv);
            vec2 uv = (vUv - 0.5) * 2.0;
            float dist = length(uv);
            float vig = smoothstep(offset, offset - 0.5, dist);
            texel.rgb = mix(texel.rgb * (1.0 - darkness), texel.rgb, vig);
            gl_FragColor = texel;
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Theme Class
// ─────────────────────────────────────────────────────────────────────────────
export default class ChromadelicHighwayTheme extends BaseTheme {
    constructor() {
        super('chromadelic-highway');

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.composer = null;
        this.clock = new THREE.Clock();
        this.time = 0;

        // Dynamic road state
        this.roadProgress = 0; // How far we've traveled
        this.curvePhase = 0; // For smooth curve animation
        this.roadMesh = null;
        this.roadGeometry = null;

        // Scene elements
        this.tunnelRings = [];
        this.starfield = null;
        this.speedParticles = null;

        // Effect intensities
        this.pulseIntensity = 0;
        this.bloomBoost = 0;
        this.particleGlow = 0; // Extra glow for particles on piece lock
        this.ringGlow = 0; // Extra glow for rings on combo

        this.eventUnsubscribers = [];
        this.qualityPreset = QUALITY_PRESETS.High;

        console.log('[ChromadelicHighway] Dynamic road theme constructed');
    }

    getTetrominoConfig() {
        return CHROMADELIC_HIGHWAY_TETROMINOS;
    }

    getCurrentQualityLevel() {
        if (typeof window !== 'undefined' && window.settings?.effectQuality) {
            return normalizeQuality(window.settings.effectQuality);
        }
        return 'High';
    }

    applyQualityPreset(quality) {
        this.qualityPreset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.High;
        console.log(`[ChromadelicHighway] Applied ${quality} quality preset`);
    }

    async createScene() {
        console.log('[ChromadelicHighway] Creating dynamic scene...');

        const quality = this.getCurrentQualityLevel();
        this.applyQualityPreset(quality);

        const container = document.getElementById('chromadelic-highway-theme');
        if (!container) {
            console.error('[ChromadelicHighway] Container not found');
            return;
        }

        this.initRenderer(container);
        this.createDynamicRoad();
        this.createTunnelRings();
        this.createStarfield();
        this.createSpeedParticles();
        this.setupPostProcessing();
        this.setupEventListeners();
        this.startAnimation();

        console.log('[ChromadelicHighway] Dynamic scene created');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Renderer & Camera - Mario Kart style behind-car view
    // ─────────────────────────────────────────────────────────────────────────

    initRenderer(container) {
        const width = window.innerWidth;
        const height = window.innerHeight;

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        this.renderer.setClearColor(0x020008, 1); // Very dark purple
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        this.renderer.setSize(width, height);

        this.renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%';
        container.appendChild(this.renderer.domElement);
        this.registerContainer(container);

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x020008, 0.0005);

        // Camera: Lower, closer to road - immersive racing view
        this.camera = new THREE.PerspectiveCamera(80, width / height, 1, 4000);
        this.camera.position.set(0, 55, 280); // Lower and closer to road
        this.camera.lookAt(0, 20, -600); // Looking ahead at road level

        console.log('[ChromadelicHighway] Renderer initialized - immersive view');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Dynamic Road - Regenerated each frame
    // ─────────────────────────────────────────────────────────────────────────

    createDynamicRoad() {
        const segments = this.qualityPreset.roadSegments;
        const roadWidth = 200;
        const roadLength = 2000;

        // Create geometry with enough vertices for dynamic updates
        this.roadGeometry = new THREE.PlaneGeometry(
            roadWidth,
            roadLength,
            1,
            segments
        );
        this.roadGeometry.rotateX(-Math.PI / 2);

        // Custom shader for rainbow road surface
        this.roadMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uProgress: { value: 0 },
                uPulse: { value: 0 },
            },
            vertexShader: `
                varying vec2 vUv;
                varying float vDepth;
                
                void main() {
                    vUv = uv;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    vDepth = -mvPosition.z;
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform float uProgress;
                uniform float uPulse;
                varying vec2 vUv;
                varying float vDepth;
                
                vec3 hsv2rgb(vec3 c) {
                    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
                    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
                    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
                }
                
                void main() {
                    // Rainbow bands flowing forward
                    float hue = fract((1.0 - vUv.y) * 4.0 + uProgress * 0.5);
                    vec3 rainbow = hsv2rgb(vec3(hue, 0.9, 0.7));
                    
                    // Lane stripes
                    float lanes = abs(sin((1.0 - vUv.y) * 100.0 + uProgress * 20.0));
                    lanes = smoothstep(0.7, 0.9, lanes);
                    rainbow += lanes * 0.15;
                    
                    // Edge glow
                    float edge = smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
                    rainbow *= edge * 0.8 + 0.2;
                    rainbow += (1.0 - edge) * 0.1;
                    
                    // Depth fade
                    float depthFade = smoothstep(2000.0, 200.0, vDepth);
                    rainbow *= 0.3 + depthFade * 0.7;
                    
                    // Pulse effect
                    rainbow *= 1.0 + uPulse * 0.3;
                    
                    gl_FragColor = vec4(rainbow, 1.0);
                }
            `,
            side: THREE.DoubleSide,
        });

        this.roadMesh = new THREE.Mesh(this.roadGeometry, this.roadMaterial);
        this.scene.add(this.roadMesh);

        console.log('[ChromadelicHighway] Dynamic road created');
    }

    updateRoadCurve() {
        if (!this.roadGeometry) return;

        const positions = this.roadGeometry.attributes.position.array;
        const segments = this.qualityPreset.roadSegments;

        // Animate curve - slower time-based phase shift for meditative feel
        const time = this.time * 0.12;

        for (let i = 0; i <= segments; i++) {
            const t = i / segments; // 0 to 1 along road (0 = near, 1 = far)
            const z = 400 - t * 2700; // Start behind camera, extend far into distance

            // MARIO KART STYLE: Near road is straight, curve increases with distance
            // Use t^2 to make curve only visible in distance
            const curveStrength = t * t; // 0 near, 1 far

            // Dynamic curve - combination of waves
            const curve1 = Math.sin(t * 2.5 + time) * 200 * curveStrength;
            const curve2 = Math.sin(t * 1.2 + time * 0.6) * 120 * curveStrength;
            const curve3 = Math.cos(t * 1.8 + time * 0.9) * 80 * curveStrength;
            const xOffset = curve1 + curve2 + curve3;

            // Gentle hills (also more pronounced in distance)
            const yOffset = Math.sin(t * 1.5 + time * 0.4) * 25 * curveStrength;

            // Update both edge vertices for this segment
            // Left edge
            const leftIdx = (i * 2) * 3;
            positions[leftIdx] = -100 + xOffset;
            positions[leftIdx + 1] = yOffset;
            positions[leftIdx + 2] = z;

            // Right edge
            const rightIdx = (i * 2 + 1) * 3;
            positions[rightIdx] = 100 + xOffset;
            positions[rightIdx + 1] = yOffset;
            positions[rightIdx + 2] = z;
        }

        this.roadGeometry.attributes.position.needsUpdate = true;
        this.roadGeometry.computeVertexNormals();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Tunnel Rings - Large rings visible on screen edges during gameplay
    // ─────────────────────────────────────────────────────────────────────────

    createTunnelRings() {
        const ringCount = this.qualityPreset.ringCount;

        for (let i = 0; i < ringCount; i++) {
            // Larger rings that will be visible around the game canvas
            const geometry = new THREE.TorusGeometry(220, 4, 8, 64);

            const hue = i / ringCount;
            const color = new THREE.Color().setHSL(hue, 0.9, 0.6);

            const material = new THREE.MeshBasicMaterial({
                color: color,
                transparent: true,
                opacity: 0.65,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });

            const ring = new THREE.Mesh(geometry, material);

            // Spread evenly into the distance, lower position
            const z = 150 - (i / ringCount) * 2400;
            ring.position.set(0, 25, z); // Lower, centered on road
            ring.userData.baseZ = z;
            ring.userData.hue = hue;
            ring.userData.speed = 3 + Math.random() * 1.5; // Slower

            this.tunnelRings.push(ring);
            this.scene.add(ring);
        }

        // Add edge glow strips - visible on left/right sides of screen
        this.createEdgeGlowStrips();

        console.log(`[ChromadelicHighway] ${ringCount} tunnel rings + edge glows created`);
    }

    createEdgeGlowStrips() {
        // Create glowing edge lines that follow the road - visible on left/right of game canvas
        this.edgeStrips = [];

        // Two edge line sets - left and right of road
        [-1, 1].forEach((side, sideIdx) => {
            const lineCount = 3; // Multiple parallel lines per side

            for (let i = 0; i < lineCount; i++) {
                const geometry = new THREE.BufferGeometry();
                const points = [];

                // Create points along the road edge
                const segments = 60;
                for (let j = 0; j <= segments; j++) {
                    const t = j / segments;
                    const z = 350 - t * 2600;
                    const xBase = side * (110 + i * 25); // Offset from road edge
                    points.push(new THREE.Vector3(xBase, 2 + i * 3, z));
                }

                geometry.setFromPoints(points);

                const hue = sideIdx === 0 ? (0.0 + i * 0.1) : (0.7 - i * 0.1); // Red/orange left, purple/magenta right
                const color = new THREE.Color().setHSL(hue, 0.9, 0.6);

                const material = new THREE.LineBasicMaterial({
                    color: color,
                    transparent: true,
                    opacity: 0.6 - i * 0.15,
                    blending: THREE.AdditiveBlending,
                });

                const line = new THREE.Line(geometry, material);
                line.userData.side = side;
                line.userData.offset = i;
                line.userData.hue = hue;

                this.edgeStrips.push(line);
                this.scene.add(line);
            }
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Starfield - Background stars
    // ─────────────────────────────────────────────────────────────────────────

    createStarfield() {
        const starCount = this.qualityPreset.starCount;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(starCount * 3);
        const colors = new Float32Array(starCount * 3);

        for (let i = 0; i < starCount; i++) {
            const i3 = i * 3;

            // Hemisphere in front of camera
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.random() * Math.PI * 0.6 + 0.2;
            const radius = 800 + Math.random() * 1500;

            positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = radius * Math.cos(phi) + 100;
            positions[i3 + 2] = -radius * Math.sin(phi) * Math.sin(theta) - 500;

            // Subtle color variation
            const brightness = 0.6 + Math.random() * 0.4;
            colors[i3] = brightness;
            colors[i3 + 1] = brightness;
            colors[i3 + 2] = brightness * (0.9 + Math.random() * 0.1);
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.PointsMaterial({
            size: 2,
            vertexColors: true,
            transparent: true,
            opacity: 0.8,
            sizeAttenuation: true,
        });

        this.starfield = new THREE.Points(geometry, material);
        this.scene.add(this.starfield);

        // Add some subtle nebula glow planes in the background
        this.createNebulaBackdrop();

        console.log(`[ChromadelicHighway] Starfield created with ${starCount} stars`);
    }

    createNebulaBackdrop() {
        // A few large, subtle gradient planes for atmosphere
        const nebulaColors = [
            { h: 0.8, s: 0.6, l: 0.3 }, // Purple
            { h: 0.6, s: 0.5, l: 0.25 }, // Cyan/blue
            { h: 0.0, s: 0.5, l: 0.3 }, // Red/pink
        ];

        nebulaColors.forEach((col, i) => {
            const size = 1500 + Math.random() * 800;
            const canvas = document.createElement('canvas');
            canvas.width = 128;
            canvas.height = 128;
            const ctx = canvas.getContext('2d');

            const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
            const color = new THREE.Color().setHSL(col.h, col.s, col.l);
            gradient.addColorStop(0, `rgba(${Math.floor(color.r * 255)},${Math.floor(color.g * 255)},${Math.floor(color.b * 255)},0.08)`);
            gradient.addColorStop(0.5, `rgba(${Math.floor(color.r * 255)},${Math.floor(color.g * 255)},${Math.floor(color.b * 255)},0.03)`);
            gradient.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 128, 128);

            const texture = new THREE.CanvasTexture(canvas);
            const geo = new THREE.PlaneGeometry(size, size);
            const mat = new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });

            const plane = new THREE.Mesh(geo, mat);
            plane.position.set(
                (Math.random() - 0.5) * 2000,
                200 + Math.random() * 400,
                -1500 - i * 500
            );
            plane.lookAt(this.camera.position);
            this.scene.add(plane);
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Speed Particles - Flow toward camera along road
    // ─────────────────────────────────────────────────────────────────────────

    createSpeedParticles() {
        const particleCount = this.qualityPreset.speedParticleCount;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);

        for (let i = 0; i < particleCount; i++) {
            const i3 = i * 3;

            // Distribute around road edges for speed line effect
            const side = Math.random() > 0.5 ? 1 : -1;
            positions[i3] = side * (80 + Math.random() * 60);
            positions[i3 + 1] = Math.random() * 60 + 5;
            positions[i3 + 2] = -Math.random() * 2200;

            // Rainbow colors with varied saturation
            const hue = Math.random();
            const color = new THREE.Color().setHSL(hue, 0.7 + Math.random() * 0.3, 0.5 + Math.random() * 0.2);
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            sizes[i] = 2 + Math.random() * 3;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        const material = new THREE.PointsMaterial({
            size: 3,
            vertexColors: true,
            transparent: true,
            opacity: 0.5,
            blending: THREE.AdditiveBlending,
            sizeAttenuation: true,
        });

        this.speedParticles = new THREE.Points(geometry, material);
        this.scene.add(this.speedParticles);

        console.log(`[ChromadelicHighway] ${particleCount} speed particles created`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Post-Processing
    // ─────────────────────────────────────────────────────────────────────────

    setupPostProcessing() {
        const width = window.innerWidth;
        const height = window.innerHeight;

        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        if (this.qualityPreset.enableBloom) {
            this.bloomPass = new UnrealBloomPass(
                new THREE.Vector2(width, height),
                this.qualityPreset.bloomStrength,
                this.qualityPreset.bloomRadius,
                this.qualityPreset.bloomThreshold
            );
            this.composer.addPass(this.bloomPass);
        }

        const vignettePass = new ShaderPass(VignetteShader);
        this.composer.addPass(vignettePass);

        console.log('[ChromadelicHighway] Post-processing ready');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Event Listeners
    // ─────────────────────────────────────────────────────────────────────────

    setupEventListeners() {
        const lockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
            if (this.isActive && window.settings?.backgroundComboEffects !== false) {
                this.pulseIntensity = Math.max(this.pulseIntensity, 0.4);
                // Additive glow build-up (Astral Weave style)
                this.particleGlow = Math.min(this.particleGlow + 0.5, 1.5);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            if (this.isActive && window.settings?.backgroundComboEffects !== false) {
                const intensity = Math.min(data.comboCount * 0.2, 1.0);
                this.pulseIntensity = Math.max(this.pulseIntensity, 0.6 + intensity * 0.4);
                this.bloomBoost = intensity * 0.3;
                this.ringGlow = 0.5 + intensity * 0.5; // Ring glow on combo
            }
        });

        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            if (this.isActive && window.settings?.backgroundComboEffects !== false) {
                const intensity = Math.min(data.lineCount * 0.25, 1.0);
                this.pulseIntensity = Math.max(this.pulseIntensity, 0.5 + intensity * 0.5);
            }
        });

        this.resizeHandler = () => this.resize(window.innerWidth, window.innerHeight);
        window.addEventListener('resize', this.resizeHandler);

        this.eventUnsubscribers.push(lockUnsub, comboUnsub, lineClearUnsub);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Animation Loop
    // ─────────────────────────────────────────────────────────────────────────

    startAnimation() {
        const animate = () => {
            if (!this.isActive) return;

            const delta = this.clock.getDelta();
            this.time += delta;
            this.roadProgress += delta * 0.3; // Even slower, more meditative speed

            // Decay effects
            this.pulseIntensity *= 0.92;
            this.bloomBoost *= 0.95;
            this.particleGlow *= 0.985; // Much smoother/slower fade for glow build-up effect
            this.ringGlow *= 0.98; // Very slow ring glow fade for much longer effect

            // Update road curve dynamically
            this.updateRoadCurve();

            // Update road shader
            if (this.roadMaterial) {
                this.roadMaterial.uniforms.uTime.value = this.time;
                this.roadMaterial.uniforms.uProgress.value = this.roadProgress;
                this.roadMaterial.uniforms.uPulse.value = this.pulseIntensity;
            }

            // Animate rings - fly toward camera, follow road curve
            this.tunnelRings.forEach((ring) => {
                ring.position.z += ring.userData.speed * 0.35; // Slower ring movement

                // Wrap around when past camera
                if (ring.position.z > 300) {
                    ring.position.z = -2100;
                    ring.userData.hue = (ring.userData.hue + 0.1) % 1.0;
                    ring.material.color.setHSL(ring.userData.hue, 0.9, 0.6);
                }

                // Follow the same curve as the road (Mario Kart style - more curve in distance)
                const t = Math.max(0, (200 - ring.position.z) / 2500); // 0 near, 1 far
                const curveStrength = t * t;
                const curve1 = Math.sin(t * 2.5 + this.time * 0.12) * 200 * curveStrength;
                const curve2 = Math.sin(t * 1.2 + this.time * 0.08) * 120 * curveStrength;
                ring.position.x = curve1 + curve2;
                ring.position.y = 25 + Math.sin(t * 1.5 + this.time * 0.06) * 20 * curveStrength;

                // Scale based on distance (smooth glow, minimal bounce)
                const scale = 0.5 + (1 - t) * 0.8 + this.ringGlow * 0.10;
                ring.scale.set(scale, scale, 1);
                ring.material.opacity = 0.25 + (1 - t) * 0.5 + this.pulseIntensity * 0.25 + this.ringGlow * 0.4;

                // Boost ring brightness on combo
                const lightness = 0.6 + this.ringGlow * 0.3;
                ring.material.color.setHSL(ring.userData.hue, 0.9, lightness);
            });

            // Animate edge glow lines - subtle color cycling and pulse response
            if (this.edgeStrips) {
                this.edgeStrips.forEach(line => {
                    line.userData.hue = (line.userData.hue + 0.0002) % 1.0;
                    line.material.color.setHSL(line.userData.hue, 0.9, 0.55);
                    const baseOpacity = 0.5 - line.userData.offset * 0.12;
                    line.material.opacity = baseOpacity + this.pulseIntensity * 0.25;
                });
            }

            // Animate speed particles - follow road corridor with glow effect
            if (this.speedParticles) {
                const positions = this.speedParticles.geometry.attributes.position.array;
                for (let i = 0; i < positions.length; i += 3) {
                    positions[i + 2] += 3 + this.pulseIntensity * 5; // Even slower particles

                    if (positions[i + 2] > 300) {
                        const side = Math.random() > 0.5 ? 1 : -1;
                        positions[i] = side * (80 + Math.random() * 60);
                        positions[i + 1] = Math.random() * 60 + 5;
                        positions[i + 2] = -2200;
                    }
                }
                this.speedParticles.geometry.attributes.position.needsUpdate = true;

                // Particle glow boost on piece lock
                this.speedParticles.material.opacity = 0.3 + this.particleGlow * 0.5; // Lower base opacity for more contrast
                this.speedParticles.material.size = 3 + this.particleGlow * 6; // Dramatic size increase
            }

            // Subtle camera sway (small movements, stays close to road)
            this.camera.position.x = Math.sin(this.time * 0.25) * 4;
            this.camera.position.y = 55 + Math.sin(this.time * 0.2) * 3;

            // Update bloom
            if (this.bloomPass) {
                this.bloomPass.strength = this.qualityPreset.bloomStrength * (1 + this.bloomBoost);
            }

            // Render
            if (this.composer) {
                this.composer.render(delta);
            } else {
                this.renderer.render(this.scene, this.camera);
            }

            this.animationFrameId = requestAnimationFrame(animate);
            this.registerAnimation(this.animationFrameId);
        };

        this.animationFrameId = requestAnimationFrame(animate);
        this.registerAnimation(this.animationFrameId);
    }

    resize(width, height) {
        if (this.camera) {
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
        }
        if (this.renderer) this.renderer.setSize(width, height);
        if (this.composer) this.composer.setSize(width, height);
    }

    stop() {
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
        }
        super.stop();
    }

    cleanup() {
        this.stop();

        if (this.scene) {
            this.scene.traverse((obj) => {
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) {
                    if (Array.isArray(obj.material)) {
                        obj.material.forEach((m) => m.dispose());
                    } else {
                        obj.material.dispose();
                    }
                }
            });
        }

        if (this.composer) this.composer.dispose();
        if (this.renderer) {
            this.renderer.dispose();
            if (this.renderer.domElement?.parentNode) {
                this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
            }
        }

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.composer = null;
        this.roadMesh = null;
        this.roadGeometry = null;
        this.tunnelRings = [];
        this.starfield = null;
        this.speedParticles = null;

        super.cleanup();
    }
}
