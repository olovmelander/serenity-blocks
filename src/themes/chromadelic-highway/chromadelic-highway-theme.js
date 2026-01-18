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
        this.ambientParticles = null; // Colorful floating particles in space
        this.planet = null; // Rainbow planet
        this.planetGlows = []; // Glow layers around planet
        this.shootingStars = []; // Rainbow shooting star trails
        this.shootingStarTimer = 0; // Timer for spawning new stars
        this.nextShootingStarDelay = 3; // Seconds until next star

        // Planet journey - 3 minute approach and flyby
        this.journeyTime = 0;
        this.journeyDuration = 180; // 3 minutes
        this.planetStartPos = new THREE.Vector3(1500, 450, -2000); // Far right, distant
        this.planetClosePos = new THREE.Vector3(700, 150, 250);    // Close flyby on right
        this.planetEndPos = new THREE.Vector3(1000, 350, 600);     // Past player, then reset

        // Effect intensities
        this.pulseIntensity = 0;
        this.bloomBoost = 0;
        this.particleGlow = 0; // Extra glow for particles on piece lock
        this.ringGlow = 0; // Extra glow for rings on combo
        this.ambientSpeedBoost = 0; // Current speed boost (smoothly interpolates to target)
        this.ambientSpeedTarget = 0; // Target speed boost (set by events, decays slowly)

        // Play pace tracking - highway speed matches how fast you play
        this.pieceLockTimes = []; // Timestamps of recent piece locks
        this.playPaceMultiplier = 1.0; // Current driving speed (1.0 = base, higher = faster)
        this.targetPaceMultiplier = 1.0; // Target pace (smoothly interpolated)

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
        this.createRainbowPlanet();
        this.createSpeedParticles();
        this.createAmbientParticles();
        this.createShootingStars();
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

        this.renderer = new THREE.WebGLRenderer({ antialias: this.getAntialiasEnabled(), alpha: false });
        this.renderer.setClearColor(0x020008, 1); // Very dark purple
        this.renderer.setPixelRatio(this.getEffectivePixelRatio(1.5));
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
    // Tunnel Rings - Neon glow rings with rotation and pulsing
    // ─────────────────────────────────────────────────────────────────────────

    createTunnelRings() {
        const ringCount = this.qualityPreset.ringCount;

        // Neon glow shader for rings
        const neonRingShader = {
            vertexShader: `
                varying vec2 vUv;
                varying vec3 vNormal;
                varying vec3 vViewPosition;

                void main() {
                    vUv = uv;
                    vNormal = normalize(normalMatrix * normal);
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    vViewPosition = -mvPosition.xyz;
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform vec3 uColor;
                uniform float uTime;
                uniform float uPulse;
                uniform float uGlow;
                varying vec2 vUv;
                varying vec3 vNormal;
                varying vec3 vViewPosition;

                void main() {
                    // Fresnel effect for edge glow
                    vec3 viewDir = normalize(vViewPosition);
                    float fresnel = 1.0 - abs(dot(viewDir, vNormal));
                    fresnel = pow(fresnel, 2.0);

                    // Pulsing core brightness
                    float pulse = 1.0 + sin(uTime * 3.0) * 0.15 * uPulse;

                    // Neon core (bright center)
                    vec3 coreColor = uColor * (1.5 + uGlow * 0.5) * pulse;

                    // Outer glow (softer, wider)
                    vec3 glowColor = uColor * (0.6 + fresnel * 0.8);

                    // Combine core and glow
                    vec3 finalColor = mix(coreColor, glowColor, fresnel * 0.5);

                    // Add extra bloom on edges
                    finalColor += uColor * fresnel * 0.4 * (1.0 + uGlow);

                    // Alpha with pulse
                    float alpha = (0.7 + fresnel * 0.3) * (0.8 + uPulse * 0.2);

                    gl_FragColor = vec4(finalColor, alpha);
                }
            `
        };

        for (let i = 0; i < ringCount; i++) {
            // Larger rings that will be visible around the game canvas
            const geometry = new THREE.TorusGeometry(220, 5, 16, 80);

            const hue = i / ringCount;
            const color = new THREE.Color().setHSL(hue, 0.9, 0.6);

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uColor: { value: color },
                    uTime: { value: 0 },
                    uPulse: { value: 0 },
                    uGlow: { value: 0 },
                },
                vertexShader: neonRingShader.vertexShader,
                fragmentShader: neonRingShader.fragmentShader,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            });

            const ring = new THREE.Mesh(geometry, material);

            // Spread evenly into the distance, lower position
            const z = 150 - (i / ringCount) * 2400;
            ring.position.set(0, 25, z);
            ring.userData.baseZ = z;
            ring.userData.hue = hue;
            ring.userData.speed = 3 + Math.random() * 1.5;
            // Rotation speed - each ring spins at a different rate (Z axis only - no clipping)
            ring.userData.rotationSpeed = (0.3 + Math.random() * 0.4) * (Math.random() > 0.5 ? 1 : -1);

            this.tunnelRings.push(ring);
            this.scene.add(ring);
        }

        // Add edge glow strips - visible on left/right sides of screen
        this.createEdgeGlowStrips();

        console.log(`[ChromadelicHighway] ${ringCount} neon tunnel rings + edge glows created`);
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
    // Rainbow Planet - Massive celestial body with neon glow
    // ─────────────────────────────────────────────────────────────────────────

    createRainbowPlanet() {
        const planetSize = 450;

        // Planet sphere with rainbow texture
        const geometry = new THREE.SphereGeometry(planetSize, 48, 48);

        // Load rainbow planet texture
        const textureLoader = new THREE.TextureLoader();
        const planetTexture = textureLoader.load('./textures/2k_rainbow_planet.png');
        planetTexture.wrapS = THREE.ClampToEdgeWrapping;
        planetTexture.wrapT = THREE.ClampToEdgeWrapping;

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uMap: { value: planetTexture },
                uPulse: { value: 0 },
            },
            vertexShader: `
                varying vec2 vUv;
                varying vec3 vNormal;
                varying vec3 vViewPosition;
                
                void main() {
                    vUv = uv;
                    vNormal = normalize(normalMatrix * normal);
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    vViewPosition = -mvPosition.xyz;
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform sampler2D uMap;
                uniform float uPulse;
                
                varying vec2 vUv;
                varying vec3 vNormal;
                varying vec3 vViewPosition;

                // HSV to RGB conversion for rainbow rim
                vec3 hsv2rgb(vec3 c) {
                    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
                    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
                    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
                }

                void main() {
                    vec3 viewDir = normalize(vViewPosition);
                    
                    // Sample the rainbow planet texture
                    vec4 texColor = texture2D(uMap, vUv);
                    vec3 baseColor = texColor.rgb;
                    
                    // Lighting - dramatic side lighting
                    vec3 lightDir = normalize(vec3(0.6, 0.4, 0.5));
                    float NdotL = dot(vNormal, lightDir);
                    float shadow = smoothstep(-0.2, 0.4, NdotL);
                    
                    // Apply shadow
                    vec3 shadowColor = baseColor * 0.15;
                    vec3 litColor = baseColor;
                    vec3 finalColor = mix(shadowColor, litColor, shadow);
                    
                    // NEON RAINBOW RIM GLOW - psychedelic fresnel effect
                    float viewDot = abs(dot(vNormal, viewDir));
                    float fresnel = pow(1.0 - viewDot, 3.0);
                    
                    // Animated rainbow hue cycling around the rim
                    float hue = fract(uTime * 0.1 + fresnel * 2.0);
                    vec3 rainbowRim = hsv2rgb(vec3(hue, 0.9, 1.0));
                    
                    // Add neon rim glow
                    finalColor += rainbowRim * fresnel * 0.8 * (1.0 + uPulse * 0.5);
                    
                    // Additional inner glow for more neon feel
                    float innerFresnel = pow(1.0 - viewDot, 1.5);
                    finalColor += baseColor * innerFresnel * 0.3;
                    
                    // Pulse brightness boost
                    finalColor *= 1.0 + uPulse * 0.2;
                    
                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `,
        });

        this.planet = new THREE.Mesh(geometry, material);
        // Position: Upper-right, far back, partially visible
        this.planet.position.set(1500, 450, -2000);
        this.planet.renderOrder = -50;
        this.scene.add(this.planet);

        // Create neon glow layers behind the planet
        const glowConfigs = [
            { size: planetSize * 2.4, opacity: 0.4, z: -30, hueOffset: 0 },
            { size: planetSize * 3.2, opacity: 0.25, z: -60, hueOffset: 0.33 },
            { size: planetSize * 4.2, opacity: 0.12, z: -100, hueOffset: 0.66 },
        ];

        glowConfigs.forEach((config, index) => {
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');

            // Create rainbow gradient glow
            const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
            gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
            gradient.addColorStop(0.2, 'rgba(255, 200, 255, 0.8)');
            gradient.addColorStop(0.5, 'rgba(150, 100, 255, 0.4)');
            gradient.addColorStop(0.8, 'rgba(100, 200, 255, 0.15)');
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 256, 256);

            const texture = new THREE.CanvasTexture(canvas);
            const glowGeo = new THREE.PlaneGeometry(config.size, config.size);
            const glowMat = new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                opacity: config.opacity,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });

            const glow = new THREE.Mesh(glowGeo, glowMat);
            glow.position.copy(this.planet.position);
            glow.position.z += config.z;
            glow.renderOrder = -60 - index;
            glow.userData.hueOffset = config.hueOffset;
            glow.userData.baseOpacity = config.opacity;
            glow.userData.zOffset = config.z;
            this.planetGlows.push(glow);
            this.scene.add(glow);
        });

        console.log('[ChromadelicHighway] Rainbow planet created with neon glow');
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

        // Same vibrant psychedelic palette as ambient particles
        const palette = [
            new THREE.Color(0xFF3366), // Hot Pink
            new THREE.Color(0x00FFFF), // Cyan
            new THREE.Color(0xFFFF00), // Yellow
            new THREE.Color(0xFF6600), // Orange
            new THREE.Color(0x9933FF), // Purple
            new THREE.Color(0x00FF66), // Mint Green
            new THREE.Color(0xFF0099), // Magenta
            new THREE.Color(0x3399FF), // Electric Blue
        ];

        for (let i = 0; i < particleCount; i++) {
            const i3 = i * 3;

            // Distribute around road edges for speed line effect
            const side = Math.random() > 0.5 ? 1 : -1;
            positions[i3] = side * (80 + Math.random() * 60);
            positions[i3 + 1] = Math.random() * 60 + 5;
            positions[i3 + 2] = -Math.random() * 2200;

            // Pick from the same palette as ambient particles
            const color = palette[Math.floor(Math.random() * palette.length)];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            sizes[i] = 4 + Math.random() * 5;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        // Custom shader material with glow effect (same as ambient particles)
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uPulse: { value: 0 },
            },
            vertexShader: `
                uniform float uPulse;
                attribute float size;
                attribute vec3 color;
                varying vec3 vColor;

                void main() {
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_Position = projectionMatrix * mvPosition;

                    // Size with distance attenuation and pulse response
                    float baseSize = size * (1.0 + uPulse * 0.5);
                    gl_PointSize = baseSize * (300.0 / -mvPosition.z);
                    gl_PointSize = clamp(gl_PointSize, 1.0, 25.0);

                    vColor = color;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;

                void main() {
                    // Soft circular particle with glow (same as ambient)
                    vec2 center = gl_PointCoord - vec2(0.5);
                    float dist = length(center);

                    // Soft edge falloff
                    float alpha = smoothstep(0.5, 0.1, dist) * 0.7;

                    // Add a brighter glowing core
                    float core = smoothstep(0.3, 0.0, dist) * 0.6;
                    vec3 finalColor = vColor + core;

                    gl_FragColor = vec4(finalColor, alpha);
                }
            `,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.speedParticles = new THREE.Points(geometry, material);
        this.scene.add(this.speedParticles);

        console.log(`[ChromadelicHighway] ${particleCount} speed particles created`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Ambient Particles - Colorful floating particles in space (Supernova-inspired)
    // ─────────────────────────────────────────────────────────────────────────

    createAmbientParticles() {
        const particleCount = Math.floor(this.qualityPreset.starCount * 0.5); // Scale with quality
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const randoms = new Float32Array(particleCount); // For phase offset
        const sizes = new Float32Array(particleCount);

        // Vibrant psychedelic palette
        const palette = [
            new THREE.Color(0xFF3366), // Hot Pink
            new THREE.Color(0x00FFFF), // Cyan
            new THREE.Color(0xFFFF00), // Yellow
            new THREE.Color(0xFF6600), // Orange
            new THREE.Color(0x9933FF), // Purple
            new THREE.Color(0x00FF66), // Mint Green
            new THREE.Color(0xFF0099), // Magenta
            new THREE.Color(0x3399FF), // Electric Blue
        ];

        for (let i = 0; i < particleCount; i++) {
            const i3 = i * 3;

            // Distribute in a wide volume around and above the road
            // Some orbiting near camera, some far in the distance
            const distribution = Math.random();

            if (distribution < 0.4) {
                // Orbiting disc around the road (closer)
                const angle = Math.random() * Math.PI * 2;
                const radius = 150 + Math.random() * 200;
                positions[i3] = Math.cos(angle) * radius;
                positions[i3 + 1] = 50 + Math.random() * 150; // Above road
                positions[i3 + 2] = Math.sin(angle) * radius - 400;
            } else if (distribution < 0.7) {
                // Scattered in the sky dome
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.random() * Math.PI * 0.5; // Upper hemisphere
                const radius = 300 + Math.random() * 400;
                positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
                positions[i3 + 1] = radius * Math.cos(phi) + 100;
                positions[i3 + 2] = -radius * Math.sin(phi) * Math.sin(theta) - 600;
            } else {
                // Trailing particles along the road corridor
                const side = Math.random() > 0.5 ? 1 : -1;
                positions[i3] = side * (150 + Math.random() * 150);
                positions[i3 + 1] = 30 + Math.random() * 100;
                positions[i3 + 2] = -Math.random() * 1800 - 200;
            }

            // Pick a random vibrant color
            const color = palette[Math.floor(Math.random() * palette.length)];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            randoms[i] = Math.random();
            sizes[i] = 3 + Math.random() * 5;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        // Custom shader material for animated floating particles
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uPulse: { value: 0 },
                uSpeedMultiplier: { value: 1.0 }, // Base speed, increases on combo
            },
            vertexShader: `
                uniform float uTime;
                uniform float uPulse;
                uniform float uSpeedMultiplier;
                attribute float aRandom;
                attribute float size;
                attribute vec3 color;
                varying vec3 vColor;
                varying float vAlpha;

                void main() {
                    vec3 pos = position;

                    // Gentle orbit rotation (different speeds per particle)
                    // Speed multiplier only affects orbit speed - particles swirl faster
                    float orbitSpeed = (0.05 + aRandom * 0.05) * uSpeedMultiplier;
                    float angle = uTime * orbitSpeed;
                    float s = sin(angle);
                    float c = cos(angle);
                    vec3 rotatedPos = vec3(
                        pos.x * c - pos.z * s,
                        pos.y,
                        pos.x * s + pos.z * c
                    );

                    // Floating motion (up/down drift) - constant gentle speed, no bouncing
                    rotatedPos.y += sin(uTime * 0.3 + aRandom * 10.0) * 15.0;

                    // Gentle side sway - constant speed
                    rotatedPos.x += sin(uTime * 0.2 + aRandom * 5.0) * 10.0;

                    vec4 mvPosition = modelViewMatrix * vec4(rotatedPos, 1.0);
                    gl_Position = projectionMatrix * mvPosition;

                    // Size with distance attenuation and pulse response
                    float baseSize = size * (1.0 + uPulse * 0.5);
                    gl_PointSize = baseSize * (300.0 / -mvPosition.z);
                    gl_PointSize = clamp(gl_PointSize, 1.0, 20.0);

                    // Pulsing alpha - constant speed for smooth effect
                    vAlpha = 0.4 + 0.4 * sin(uTime * 1.5 + aRandom * 10.0) + uPulse * 0.3;
                    vColor = color;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                varying float vAlpha;

                void main() {
                    // Soft circular particle with glow
                    vec2 center = gl_PointCoord - vec2(0.5);
                    float dist = length(center);

                    // Soft edge falloff
                    float alpha = smoothstep(0.5, 0.1, dist) * vAlpha;

                    // Add a brighter core
                    float core = smoothstep(0.3, 0.0, dist) * 0.5;
                    vec3 finalColor = vColor + core;

                    gl_FragColor = vec4(finalColor, alpha);
                }
            `,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.ambientParticles = new THREE.Points(geometry, material);
        this.scene.add(this.ambientParticles);

        console.log(`[ChromadelicHighway] ${particleCount} ambient particles created`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Shooting Stars - Rainbow gradient trails across the sky
    // ─────────────────────────────────────────────────────────────────────────

    createShootingStars() {
        // Just initializes the system - stars spawn dynamically in animate()
        console.log('[ChromadelicHighway] Shooting star system initialized');
    }

    spawnShootingStar() {
        // Random spawn position - ALL OVER THE SCREEN
        const startX = (Math.random() - 0.5) * 2500; // Full width spread
        const startY = 100 + Math.random() * 600;    // Low to high on screen
        const startZ = -800 - Math.random() * 1500;  // Various depths

        // Direction: random diagonal arc
        const angle = Math.random() * Math.PI * 2;
        const dirX = Math.cos(angle) * (0.5 + Math.random() * 0.5);
        const dirY = -0.2 - Math.random() * 0.4; // Mostly downward
        const dirZ = 0.2 + Math.random() * 0.3;

        // Trail - more particles for bigger, vibrant fire effect
        const trailLength = 350 + Math.random() * 200; // LONGER TAIL
        const particleCount = 80; // More particles for longer tail

        // Create geometry for fire particles
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);

        // Vibrant fire rainbow gradient (hot core -> colorful fire tail)
        const fireColors = [
            { r: 1.0, g: 1.0, b: 1.0 },   // Brilliant white (head)
            { r: 1.0, g: 1.0, b: 0.8 },   // Hot white
            { r: 1.0, g: 0.9, b: 0.4 },   // Bright yellow
            { r: 1.0, g: 0.7, b: 0.1 },   // Intense orange-yellow
            { r: 1.0, g: 0.4, b: 0.1 },   // Fiery orange
            { r: 1.0, g: 0.2, b: 0.1 },   // Hot red-orange
            { r: 0.9, g: 0.1, b: 0.2 },   // Vibrant red
            { r: 0.8, g: 0.1, b: 0.4 },   // Red-magenta
            { r: 0.6, g: 0.1, b: 0.7 },   // Magenta-purple
            { r: 0.4, g: 0.2, b: 0.9 },   // Vibrant purple
            { r: 0.3, g: 0.3, b: 1.0 },   // Electric blue
            { r: 0.2, g: 0.5, b: 0.9 },   // Cyan-blue
        ];

        for (let i = 0; i < particleCount; i++) {
            const t = i / (particleCount - 1);
            // REVERSED: negative offset so tail trails BEHIND the head (head is at i=0)
            const trailOffset = -t * trailLength;

            // Add some randomness for fire-like spread (more at tail)
            const spread = t * 12;
            const offsetX = (Math.random() - 0.5) * spread;
            const offsetY = (Math.random() - 0.5) * spread;

            // Position along trail with spread (head at start position, tail behind)
            positions[i * 3] = startX + dirX * trailOffset + offsetX;
            positions[i * 3 + 1] = startY + dirY * trailOffset + offsetY;
            positions[i * 3 + 2] = startZ + dirZ * trailOffset;

            // Color from fire gradient
            const colorIdx = Math.min(Math.floor(t * (fireColors.length - 1)), fireColors.length - 2);
            const colorT = (t * (fireColors.length - 1)) - colorIdx;
            const c1 = fireColors[colorIdx];
            const c2 = fireColors[colorIdx + 1];

            colors[i * 3] = c1.r + (c2.r - c1.r) * colorT;
            colors[i * 3 + 1] = c1.g + (c2.g - c1.g) * colorT;
            colors[i * 3 + 2] = c1.b + (c2.b - c1.b) * colorT;

            // Size: large bright head (i=0), smaller tail particles
            const baseSize = 30 + Math.random() * 20;
            sizes[i] = baseSize * (1 - t * 0.6);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));

        // Store random offsets for tail animation
        const randoms = new Float32Array(particleCount);
        for (let i = 0; i < particleCount; i++) {
            randoms[i] = Math.random();
        }
        geometry.setAttribute('aRandom', new THREE.Float32BufferAttribute(randoms, 1));

        // Shader material for glowing fire particles with animated tail
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uOpacity: { value: 1.0 },
                uTime: { value: 0.0 },
            },
            vertexShader: `
                attribute float size;
                attribute vec3 color;
                attribute float aRandom;
                varying vec3 vColor;
                varying float vRandom;
                uniform float uTime;
                
                void main() {
                    vColor = color;
                    vRandom = aRandom;
                    
                    // Add animated shimmer to tail particles - MUCH MORE VISIBLE
                    vec3 pos = position;
                    float tailFactor = 1.0 - size / 50.0; // More shimmer on smaller (tail) particles
                    pos.x += sin(uTime * 12.0 + aRandom * 20.0) * tailFactor * 10.0;
                    pos.y += cos(uTime * 10.0 + aRandom * 20.0) * tailFactor * 10.0;
                    
                    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                    gl_Position = projectionMatrix * mvPosition;
                    gl_PointSize = size * (400.0 / -mvPosition.z);
                    gl_PointSize = clamp(gl_PointSize, 2.0, 100.0);
                }
            `,
            fragmentShader: `
                uniform float uOpacity;
                varying vec3 vColor;
                varying float vRandom;
                
                void main() {
                    vec2 center = gl_PointCoord - vec2(0.5);
                    float dist = length(center);
                    
                    // Soft glowing circle
                    float alpha = smoothstep(0.5, 0.0, dist) * uOpacity;
                    
                    // Add bright core
                    float core = smoothstep(0.25, 0.0, dist) * 0.6;
                    vec3 finalColor = vColor + core;
                    
                    gl_FragColor = vec4(finalColor, alpha);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        const points = new THREE.Points(geometry, material);
        points.userData = {
            velocity: new THREE.Vector3(dirX, dirY, dirZ).multiplyScalar(200 + Math.random() * 100), // Slower for longer screen time
            life: 0,
            maxLife: 6 + Math.random() * 4, // LONGER ON SCREEN (6-10 seconds)
        };

        this.shootingStars.push(points);
        this.scene.add(points);
    }

    updateShootingStars(delta) {
        // Spawn new stars periodically
        this.shootingStarTimer += delta;
        if (this.shootingStarTimer >= this.nextShootingStarDelay) {
            this.spawnShootingStar();
            this.shootingStarTimer = 0;
            this.nextShootingStarDelay = 4 + Math.random() * 8; // 4-12 seconds between stars
        }

        // Update existing stars
        for (let i = this.shootingStars.length - 1; i >= 0; i--) {
            const star = this.shootingStars[i];
            star.userData.life += delta;

            // Move the trail
            const positions = star.geometry.attributes.position.array;
            for (let j = 0; j < positions.length; j += 3) {
                positions[j] += star.userData.velocity.x * delta;
                positions[j + 1] += star.userData.velocity.y * delta;
                positions[j + 2] += star.userData.velocity.z * delta;
            }
            star.geometry.attributes.position.needsUpdate = true;

            // Update time for tail animation
            if (star.material.uniforms && star.material.uniforms.uTime) {
                star.material.uniforms.uTime.value = this.time;
            }

            // Fade out near end of life
            const lifeRatio = star.userData.life / star.userData.maxLife;
            if (lifeRatio > 0.7 && star.material.uniforms) {
                star.material.uniforms.uOpacity.value = 1.0 * (1 - (lifeRatio - 0.7) / 0.3);
            }

            // Remove dead stars
            if (star.userData.life >= star.userData.maxLife) {
                this.scene.remove(star);
                star.geometry.dispose();
                star.material.dispose();
                this.shootingStars.splice(i, 1);
            }
        }
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
    // Play Pace Tracking - Highway speed matches your play speed
    // ─────────────────────────────────────────────────────────────────────────

    updatePlayPace() {
        if (this.pieceLockTimes.length < 2) return;

        // Calculate average time between recent piece locks
        const times = this.pieceLockTimes;
        let totalInterval = 0;
        for (let i = 1; i < times.length; i++) {
            totalInterval += times[i] - times[i - 1];
        }
        const avgInterval = totalInterval / (times.length - 1);

        // Convert to pieces per minute (PPM)
        // avgInterval is in ms, so PPM = 60000 / avgInterval
        const ppm = 60000 / avgInterval;

        // Map PPM to speed multiplier:
        // ~20 PPM (slow/casual) = 1.0x speed
        // ~40 PPM (medium) = 1.5x speed
        // ~60 PPM (fast) = 2.0x speed
        // ~90+ PPM (very fast) = 2.5x speed
        const targetSpeed = Math.min(Math.max(ppm / 40, 0.5), 2.5);
        this.targetPaceMultiplier = targetSpeed;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Event Listeners
    // ─────────────────────────────────────────────────────────────────────────

    setupEventListeners() {
        const lockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
            if (this.isActive) {
                // Track piece lock timing for play pace
                const now = performance.now();
                this.pieceLockTimes.push(now);
                // Keep only last 10 locks for averaging
                if (this.pieceLockTimes.length > 10) {
                    this.pieceLockTimes.shift();
                }
                // Calculate play pace from recent locks
                this.updatePlayPace();

                if (window.settings?.backgroundComboEffects !== false) {
                    this.pulseIntensity = Math.max(this.pulseIntensity, 0.4);
                    // Additive glow build-up (Astral Weave style)
                    this.particleGlow = Math.min(this.particleGlow + 0.5, 1.5);
                    // Gradually increase target speed on each piece lock
                    this.ambientSpeedTarget = Math.min(this.ambientSpeedTarget + 0.1, 2.5);
                }
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            if (this.isActive && window.settings?.backgroundComboEffects !== false) {
                const intensity = Math.min(data.comboCount * 0.2, 1.0);
                this.pulseIntensity = Math.max(this.pulseIntensity, 0.6 + intensity * 0.4);
                this.bloomBoost = intensity * 0.3;
                this.ringGlow = 0.5 + intensity * 0.5; // Ring glow on combo
                // Bigger target speed boost on combo
                this.ambientSpeedTarget = Math.min(this.ambientSpeedTarget + 0.3 + intensity * 0.5, 2.5);
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

            // Play pace: smoothly interpolate towards target, decay target towards 1.0 when idle
            this.targetPaceMultiplier += (1.0 - this.targetPaceMultiplier) * 0.002; // Slowly decay towards base speed
            this.playPaceMultiplier += (this.targetPaceMultiplier - this.playPaceMultiplier) * 0.03; // Smooth transition

            // Road progress speed scales with play pace
            this.roadProgress += delta * 0.3 * this.playPaceMultiplier;

            // Decay effects
            this.pulseIntensity *= 0.92;
            this.bloomBoost *= 0.95;
            this.particleGlow *= 0.985; // Much smoother/slower fade for glow build-up effect
            this.ringGlow *= 0.98; // Very slow ring glow fade for much longer effect

            // Ambient speed: target decays very slowly, actual speed smoothly follows target
            this.ambientSpeedTarget *= 0.9995; // Very slow decay - speed stays elevated much longer after combos
            this.ambientSpeedBoost += (this.ambientSpeedTarget - this.ambientSpeedBoost) * 0.02; // Smooth lerp towards target

            // Update road curve dynamically
            this.updateRoadCurve();

            // Update shooting stars
            this.updateShootingStars(delta);

            // Update road shader
            if (this.roadMaterial) {
                this.roadMaterial.uniforms.uTime.value = this.time;
                this.roadMaterial.uniforms.uProgress.value = this.roadProgress;
                this.roadMaterial.uniforms.uPulse.value = this.pulseIntensity;
            }

            // Animate rings - fly toward camera, follow road curve, rotate and pulse
            this.tunnelRings.forEach((ring) => {
                ring.position.z += ring.userData.speed * 0.35 * this.playPaceMultiplier; // Speed scales with play pace

                // Wrap around when past camera
                if (ring.position.z > 300) {
                    ring.position.z = -2100;
                    ring.userData.hue = (ring.userData.hue + 0.1) % 1.0;
                }

                // Follow the same curve as the road (Mario Kart style - more curve in distance)
                const t = Math.max(0, (200 - ring.position.z) / 2500); // 0 near, 1 far
                const curveStrength = t * t;
                const curve1 = Math.sin(t * 2.5 + this.time * 0.12) * 200 * curveStrength;
                const curve2 = Math.sin(t * 1.2 + this.time * 0.08) * 120 * curveStrength;
                ring.position.x = curve1 + curve2;
                ring.position.y = 25 + Math.sin(t * 1.5 + this.time * 0.06) * 20 * curveStrength;

                // Rotation - rings spin on Z axis (facing camera, no clipping through road)
                const rotSpeed = ring.userData.rotationSpeed * this.playPaceMultiplier;
                ring.rotation.z += rotSpeed * 0.015;

                // Scale based on distance (smooth glow, minimal bounce)
                const scale = 0.5 + (1 - t) * 0.8 + this.ringGlow * 0.10;
                ring.scale.set(scale, scale, 1);

                // Update shader uniforms for neon glow effect
                if (ring.material.uniforms) {
                    ring.material.uniforms.uTime.value = this.time;
                    ring.material.uniforms.uPulse.value = this.pulseIntensity + this.ringGlow;
                    ring.material.uniforms.uGlow.value = this.ringGlow;
                    // Update color with new hue
                    const color = new THREE.Color().setHSL(ring.userData.hue, 0.95, 0.55 + this.ringGlow * 0.2);
                    ring.material.uniforms.uColor.value = color;
                }
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

            // Animate rainbow planet - 3 minute journey approach and flyby
            if (this.planet) {
                this.planet.rotation.y += 0.0008; // Slow majestic spin

                // Update journey time (loops every 3 minutes)
                this.journeyTime += delta;
                if (this.journeyTime >= this.journeyDuration) {
                    this.journeyTime = 0; // Reset for next loop
                }

                // Smoothstep helper for natural easing
                const smoothstep = (t) => t * t * (3 - 2 * t);

                // Journey phases:
                // 0-120s: Approach (distant to close)
                // 120-160s: Flyby (close pass)
                // 160-180s: Departure (past player, then reset)

                const approachEnd = 120;
                const flybyEnd = 160;

                let targetPos = new THREE.Vector3();
                let glowBoost = 0;

                if (this.journeyTime < approachEnd) {
                    // APPROACH PHASE: Start -> Close
                    const t = smoothstep(this.journeyTime / approachEnd);
                    targetPos.lerpVectors(this.planetStartPos, this.planetClosePos, t);
                    glowBoost = t * 0.5; // Glow increases as planet nears
                } else if (this.journeyTime < flybyEnd) {
                    // FLYBY PHASE: Close pass (slight movement, dramatic presence)
                    const phaseTime = (this.journeyTime - approachEnd) / (flybyEnd - approachEnd);
                    const t = smoothstep(phaseTime);
                    targetPos.lerpVectors(this.planetClosePos, this.planetEndPos, t);
                    glowBoost = 0.5 - t * 0.3; // Peak glow at start of flyby, then fades
                } else {
                    // DEPARTURE PHASE: Past player, quick reset back to start
                    const phaseTime = (this.journeyTime - flybyEnd) / (this.journeyDuration - flybyEnd);
                    const t = smoothstep(phaseTime);
                    targetPos.lerpVectors(this.planetEndPos, this.planetStartPos, t);
                    glowBoost = 0.2 * (1 - t); // Fading glow as it resets
                }

                // Apply position
                this.planet.position.copy(targetPos);

                // Update shader uniforms
                if (this.planet.material.uniforms) {
                    this.planet.material.uniforms.uTime.value = this.time;
                    this.planet.material.uniforms.uPulse.value = this.pulseIntensity + glowBoost;
                }

                // Sync glow layers with planet
                this.planetGlows.forEach((glow, i) => {
                    glow.position.x = this.planet.position.x;
                    glow.position.y = this.planet.position.y;
                    glow.position.z = this.planet.position.z + glow.userData.zOffset;
                    // Enhanced glow during close approach
                    glow.material.opacity = glow.userData.baseOpacity * (1.0 + this.pulseIntensity * 0.3 + glowBoost);
                });
            }

            // Animate speed particles - follow road corridor with glow effect
            if (this.speedParticles) {
                const positions = this.speedParticles.geometry.attributes.position.array;
                const particleSpeed = (3 + this.pulseIntensity * 5) * this.playPaceMultiplier; // Scale with play pace
                for (let i = 0; i < positions.length; i += 3) {
                    positions[i + 2] += particleSpeed;

                    if (positions[i + 2] > 300) {
                        const side = Math.random() > 0.5 ? 1 : -1;
                        positions[i] = side * (80 + Math.random() * 60);
                        positions[i + 1] = Math.random() * 60 + 5;
                        positions[i + 2] = -2200;
                    }
                }
                this.speedParticles.geometry.attributes.position.needsUpdate = true;

                // Particle glow boost on piece lock (via shader uniform)
                if (this.speedParticles.material.uniforms) {
                    this.speedParticles.material.uniforms.uPulse.value = this.pulseIntensity + this.particleGlow * 0.8;
                }
            }

            // Animate ambient particles - update shader uniforms
            if (this.ambientParticles && this.ambientParticles.material.uniforms) {
                this.ambientParticles.material.uniforms.uTime.value = this.time;
                this.ambientParticles.material.uniforms.uPulse.value = this.pulseIntensity + this.particleGlow * 0.5;
                // Speed multiplier: base 1.0 + boost (max ~4x speed during intense combos)
                this.ambientParticles.material.uniforms.uSpeedMultiplier.value = 1.0 + this.ambientSpeedBoost;
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
        this.ambientParticles = null;

        super.cleanup();
    }
}
