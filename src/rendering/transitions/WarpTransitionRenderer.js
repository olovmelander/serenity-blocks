/**
 * @fileoverview WarpTransitionRenderer - Cinematic orb-portal level transition
 *
 * Creates a themed warp tunnel effect that feels like diving through
 * the selected level orb into the gameplay world.
 *
 * Three cinematic phases:
 *   Phase 1 (0-30%): Circular iris vignette tightens, orb focus
 *   Phase 2 (30-60%): Portal ring expands, energy vortex spirals inward
 *   Phase 3 (60-100%): Full themed warp tunnel, fade out to gameplay
 *
 * All colors are driven by chapter/theme config passed at play() time.
 */

import * as THREE from 'three';
import { resolveWarpQualityProfile } from './warp-quality-profiles.js';
import { TRANSITION_LAYERS } from './transition-layer-constants.js';

/**
 * WarpTransitionRenderer - Creates themed orb-portal warp transitions
 */
export class WarpTransitionRenderer {
    constructor() {
        this.container = null;
        this.scene = null;
        this.camera = null;
        this.renderer = null;

        // Effect meshes
        this.starTrails = null;
        this.energySpiral = null;
        this.portalRing = null;
        this.centralGlow = null;
        this.irisVignette = null;
        this.exitFlash = null;

        // Animation state
        this.isAnimating = false;
        this.animationId = null;
        this.startTime = 0;
        this.duration = 8000;
        this.onComplete = null;
        this.externalCompositor = null;
        this.portalAnchor = { x: 0.5, y: 0.5, radius: 0.16 };
        this.qualityProfile = resolveWarpQualityProfile('High');

        // Theme colors (defaults, overridden per-play)
        this.colors = {
            primary: new THREE.Color(0x00ccff),
            secondary: new THREE.Color(0x8855ff),
            accent: new THREE.Color(0xff55aa),
            white: new THREE.Color(0xffffff),
        };

        // Configuration
        this.config = {
            starCount: 4000,
            spiralCount: 1500,
            portalRingSegments: 128,
            tunnelLength: 100,
            tunnelRadius: 20,
        };

        console.log('[WarpTransition] Orb-portal renderer created');
    }

    /**
     * Initialize the Three.js scene
     */
    init() {
        if (this.container) return;

        // Create container
        this.container = document.createElement('div');
        this.container.id = 'warp-transition-container';
        this.container.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: ${TRANSITION_LAYERS.WARP_LAYER};
            pointer-events: none;
            opacity: 0;
            background: #000;
        `;
        document.body.appendChild(this.container);

        // Scene
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x000005, 0.012);

        // Camera
        this.camera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.1, 500);
        this.camera.position.set(0, 0, 0);
        this.camera.lookAt(0, 0, -50);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.qualityProfile.pixelRatioCap ?? 2));
        this.renderer.setClearColor(0x000000, 1);
        this.container.appendChild(this.renderer.domElement);

        // Create all effects
        this.createStarTrails();
        this.createEnergySpiral();
        this.createPortalRing();
        this.createCentralGlow();
        this.createIrisVignette();
        this.applyPortalAnchorToMeshes();

        // Handle resize
        this.resizeHandler = this.onResize.bind(this);
        window.addEventListener('resize', this.resizeHandler);

        console.log('[WarpTransition] Scene initialized');
    }

    // ═══════════════════════════════════════════════════════════════
    // EFFECT CREATION
    // ═══════════════════════════════════════════════════════════════

    /**
     * Create hyperspace star trails colored by theme
     */
    createStarTrails() {
        const count = this.config.starCount;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const speeds = new Float32Array(count);
        const offsets = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;
            const angle = Math.random() * Math.PI * 2;
            const radius = 3 + Math.random() * this.config.tunnelRadius;
            const z = -Math.random() * this.config.tunnelLength;

            positions[i3] = Math.cos(angle) * radius;
            positions[i3 + 1] = Math.sin(angle) * radius;
            positions[i3 + 2] = z;

            // Store normalized color mix factor; actual colors applied via uniform
            const colorMix = Math.random();
            colors[i3] = colorMix;     // mix factor stored in R channel
            colors[i3 + 1] = 0;
            colors[i3 + 2] = 0;

            sizes[i] = 1 + Math.random() * 3;
            speeds[i] = 0.5 + Math.random() * 1.5;
            offsets[i] = Math.random() * 100;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
        geometry.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uProgress: { value: 0 },
                uStretch: { value: 1 },
                uColorPrimary: { value: this.colors.primary.clone() },
                uColorSecondary: { value: this.colors.secondary.clone() },
                uColorWhite: { value: new THREE.Color(0xffffff) },
            },
            vertexShader: `
                attribute float size;
                attribute vec3 color;
                attribute float aSpeed;
                attribute float aOffset;

                varying float vColorMix;
                varying float vAlpha;
                varying float vZ;

                uniform float uTime;
                uniform float uProgress;
                uniform float uStretch;

                void main() {
                    vColorMix = color.r;

                    vec3 pos = position;
                    float speed = aSpeed * (0.5 + uProgress * 4.5); // Faster stars
                    pos.z = mod(pos.z + uTime * speed * 40.0 + aOffset, 100.0) - 100.0;
                    vZ = pos.z;

                    // Gravitational Lensing: Parabolic outward bend as they get closer (z -> 0)
                    float lensFactor = smoothstep(-80.0, 0.0, pos.z) * uProgress * 2.5;
                    pos.xy *= (1.0 + lensFactor * 0.8);

                    float stretch = 1.0 + uStretch * uProgress * 12.0; // Extreme stretching
                    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                    float dist = -mvPosition.z;
                    gl_PointSize = size * (400.0 / dist) * stretch;

                    vAlpha = smoothstep(100.0, 10.0, dist) * (0.3 + uProgress * 0.7);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying float vColorMix;
                varying float vAlpha;
                varying float vZ;
                uniform float uProgress;
                uniform float uTime;
                uniform vec3 uColorPrimary;
                uniform vec3 uColorSecondary;
                uniform vec3 uColorWhite;

                void main() {
                    vec2 center = gl_PointCoord - 0.5;
                    float stretch = 1.0 + uProgress * 5.0;
                    center.x *= stretch;
                    float dist = length(center);
                    if (dist > 0.5) discard;

                    float alpha = (1.0 - dist * 2.0) * vAlpha;
                    alpha = pow(alpha, 0.7);
                    
                    // Add high-speed flickering
                    float flicker = 0.65 + 0.35 * sin(uTime * 60.0 + vColorMix * 100.0);
                    alpha *= (0.5 + uProgress * 0.5 * flicker);

                    // Blend theme colors based on stored mix factor
                    vec3 color;
                    if (vColorMix < 0.5) {
                        color = mix(uColorWhite, uColorPrimary, vColorMix * 2.0);
                    } else {
                        color = mix(uColorPrimary, uColorSecondary, (vColorMix - 0.5) * 2.0);
                    }
                    
                    // Relativistic Blueshift: Shift color towards pure white at max velocity
                    // and when the star is close (vZ > -20.0)
                    float blueshift = smoothstep(-30.0, 0.0, vZ) * uProgress;
                    color = mix(color, uColorWhite, blueshift * 0.85);
                    
                    color *= (1.0 + uProgress * 1.5); // Brighten under speed

                    gl_FragColor = vec4(color, alpha);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.starTrails = new THREE.Points(geometry, material);
        this.scene.add(this.starTrails);
    }

    /**
     * Create continuous Volumetric FBM Wormhole
     * AAA UPGRADE: Replaces 15k overlapping points with a dense mathematical plasma shader
     */
    createEnergySpiral() {
        // Massive cylinder enveloping the camera
        const geometry = new THREE.CylinderGeometry(
            this.config.tunnelRadius * 1.5, // radius top
            this.config.tunnelRadius * 0.8, // radius bottom
            this.config.tunnelLength,       // height
            32,                             // radial segments
            1                               // height segments
        );
        // Rotate so it extends along the Z axis
        geometry.rotateX(Math.PI / 2);
        // Translate so camera starts inside it
        geometry.translate(0, 0, -this.config.tunnelLength / 2);

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uProgress: { value: 0 },
                uColorPrimary: { value: this.colors.primary.clone() },
                uColorSecondary: { value: this.colors.secondary.clone() },
            },
            vertexShader: `
                varying vec2 vUv;
                varying vec3 vWorldPos;
                
                void main() {
                    vUv = uv;
                    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                    vWorldPos = worldPosition.xyz;
                    gl_Position = projectionMatrix * viewMatrix * worldPosition;
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform float uProgress;
                uniform vec3 uColorPrimary;
                uniform vec3 uColorSecondary;

                varying vec2 vUv;
                varying vec3 vWorldPos;

                // 3D Noise function (Simplex/Perlin derivative)
                vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
                vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

                float snoise(vec3 v) {
                    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
                    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

                    // First corner
                    vec3 i  = floor(v + dot(v, C.yyy));
                    vec3 x0 = v - i + dot(i, C.xxx);

                    // Other corners
                    vec3 g = step(x0.yzx, x0.xyz);
                    vec3 l = 1.0 - g;
                    vec3 i1 = min(g.xyz, l.zxy);
                    vec3 i2 = max(g.xyz, l.zxy);

                    vec3 x1 = x0 - i1 + C.xxx;
                    vec3 x2 = x0 - i2 + C.yyy;
                    vec3 x3 = x0 - D.yyy;

                    // Permutations
                    i = mod289(i);
                    vec4 p = permute(permute(permute(
                                i.z + vec4(0.0, i1.z, i2.z, 1.0))
                              + i.y + vec4(0.0, i1.y, i2.y, 1.0))
                              + i.x + vec4(0.0, i1.x, i2.x, 1.0));

                    // Gradients: 7x7 points over a square, mapped onto an octahedron.
                    // The ring size 17*17 = 289 is close to a multiple of 49 (49*6 = 294)
                    float n_ = 0.142857142857; // 1.0/7.0
                    vec3  ns = n_ * D.wyz - D.xzx;

                    vec4 j = p - 49.0 * floor(p * ns.z * ns.z); // mod(p,7*7)

                    vec4 x_ = floor(j * ns.z);
                    vec4 y_ = floor(j - 7.0 * x_); // mod(j,N)

                    vec4 x = x_ *ns.x + ns.yyyy;
                    vec4 y = y_ *ns.x + ns.yyyy;
                    vec4 h = 1.0 - abs(x) - abs(y);

                    vec4 b0 = vec4(x.xy, y.xy);
                    vec4 b1 = vec4(x.zw, y.zw);

                    vec4 s0 = floor(b0)*2.0 + 1.0;
                    vec4 s1 = floor(b1)*2.0 + 1.0;
                    vec4 sh = -step(h, vec4(0.0));

                    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
                    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;

                    vec3 p0 = vec3(a0.xy, h.x);
                    vec3 p1 = vec3(a0.zw, h.y);
                    vec3 p2 = vec3(a1.xy, h.z);
                    vec3 p3 = vec3(a1.zw, h.w);

                    // Normalise gradients
                    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
                    p0 *= norm.x;
                    p1 *= norm.y;
                    p2 *= norm.z;
                    p3 *= norm.w;

                    // Mix final noise value
                    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
                    m = m * m;
                    return 42.0 * dot( m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
                }

                // Fractal Brownian Motion
                float fbm(vec3 x) {
                    float v = 0.0;
                    float a = 0.5;
                    vec3 shift = vec3(100);
                    for (int i = 0; i < 4; ++i) { // 4 octaves for balance of detail and performance
                        v += a * snoise(x);
                        x = x * 2.0 + shift;
                        a *= 0.5;
                    }
                    return v;
                }

                void main() {
                    // Map cylinder UVs into a continuous polar flow
                    float rho = vUv.x * 6.2831853; // angle around cylinder
                    float z = vUv.y * 10.0;      // length down cylinder
                    
                    // Domain warping: animate the sampling coordinates
                    // Twisting the tunnel based on speed and time
                    float speed = 1.0 + uProgress * 25.0; // Enormous speed ramp
                    vec3 coord = vec3(
                        cos(rho) * 1.2 + sin(z * 0.5 + uTime) * 0.5,
                        sin(rho) * 1.2 + cos(z * 0.5 - uTime) * 0.5,
                        z - uTime * speed
                    );

                    // Dual layer FBM for rich, folding plasma
                    float q = fbm(coord * 0.8);
                    float r = fbm(coord * 1.5 + vec3(q, uTime * 2.0, -uTime * speed * 1.2));
                    float noiseBlock = fbm(coord + vec3(r));

                    // Carve out the dark structural veins
                    float plasma = smoothstep(0.2, 0.8, noiseBlock);
                    
                    // Add secondary high-frequency highlight
                    float highlight = smoothstep(0.6, 1.0, r) * 1.5;

                    // Map themes: Primary for base gas, Secondary for hot veins
                    vec3 color = mix(uColorPrimary * 0.3, uColorPrimary * 1.2, plasma);
                    color = mix(color, vec3(1.0, 0.9, 0.8), highlight * plasma); // White-hot core

                    // Alpha masking: deep black voids
                    float alpha = smoothstep(0.1, 0.5, noiseBlock) * uProgress * (0.4 + plasma * 0.6);
                    
                    // Depth fade (clip far away to avoid harsh edge)
                    float depthFade = smoothstep(-150.0, -20.0, vWorldPos.z);
                    alpha *= depthFade;

                    gl_FragColor = vec4(color, alpha);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.BackSide, // View from inside
        });

        this.energySpiral = new THREE.Mesh(geometry, material);
        // Ensure it always renders behind closer VFX
        this.energySpiral.renderOrder = 10;
        this.scene.add(this.energySpiral);
    }

    /**
     * Create portal ring — a glowing aperture that expands from the orb center
     * This is the signature "entering the orb" effect
     */
    createPortalRing() {
        const segments = this.config.portalRingSegments;
        const geometry = new THREE.RingGeometry(0.5, 3.0, segments);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uProgress: { value: 0 },
                uPhase: { value: 0 },
                uColorPrimary: { value: this.colors.primary.clone() },
                uColorAccent: { value: this.colors.accent.clone() },
            },
            vertexShader: `
                varying vec2 vUv;
                varying float vRadius;
                uniform float uPhase;
                uniform float uTime;

                void main() {
                    vUv = uv;

                    // Compute radius from center of ring
                    vRadius = length(position.xy);

                    // Scale the ring based on portal phase
                    float scale = mix(0.5, 25.0, uPhase);
                    vec3 pos = position * scale;

                    // Add subtle wobble
                    float wobble = sin(uTime * 3.0 + atan(position.y, position.x) * 6.0) * 0.15 * uPhase;
                    pos.xy *= 1.0 + wobble;

                    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                }
            `,
            fragmentShader: `
                varying vec2 vUv;
                varying float vRadius;
                uniform float uTime;
                uniform float uProgress;
                uniform float uPhase;
                uniform vec3 uColorPrimary;
                uniform vec3 uColorAccent;

                void main() {
                    // Ring glow — bright at edges, transparent in center
                    float innerEdge = smoothstep(0.3, 0.45, vUv.y);
                    float outerEdge = smoothstep(1.0, 0.7, vUv.y);
                    float ring = innerEdge * outerEdge;

                    // Energy pulse along the ring
                    float angle = atan(vUv.x - 0.5, vUv.y - 0.5);
                    float pulse = sin(angle * 8.0 + uTime * 6.0) * 0.4 + 0.6;
                    float pulse2 = sin(angle * 12.0 - uTime * 4.0) * 0.3 + 0.7;

                    // Color blend with energy arcs
                    vec3 color = mix(uColorPrimary, uColorAccent, pulse * 0.5);
                    color *= 1.5 + pulse2 * 0.5;

                    // Bright edge corona
                    float corona = pow(ring, 1.5) * pulse * pulse2;
                    color += vec3(1.0) * corona * 0.3;

                    float alpha = ring * uProgress * (0.6 + pulse * 0.4);

                    // Fade out as ring expands past screen (late phase)
                    alpha *= smoothstep(1.0, 0.7, uPhase);

                    gl_FragColor = vec4(color, alpha);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        });

        this.portalRing = new THREE.Mesh(geometry, material);
        this.portalRing.position.set(0, 0, -8);
        this.scene.add(this.portalRing);
    }

    /**
     * Create central glow — bright themed core at destination
     */
    createCentralGlow() {
        const geometry = new THREE.SphereGeometry(3, 32, 32);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uProgress: { value: 0 },
                uColorPrimary: { value: this.colors.primary.clone() },
            },
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vPosition;
                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    vPosition = position;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                varying vec3 vNormal;
                varying vec3 vPosition;
                uniform float uTime;
                uniform float uProgress;
                uniform vec3 uColorPrimary;

                // Simple 3D noise for the flare
                vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
                vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

                float snoise(vec3 v) {
                    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
                    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
                    vec3 i  = floor(v + dot(v, C.yyy));
                    vec3 x0 = v - i + dot(i, C.xxx);
                    vec3 g = step(x0.yzx, x0.xyz);
                    vec3 l = 1.0 - g;
                    vec3 i1 = min(g.xyz, l.zxy);
                    vec3 i2 = max(g.xyz, l.zxy);
                    vec3 x1 = x0 - i1 + C.xxx;
                    vec3 x2 = x0 - i2 + C.yyy;
                    vec3 x3 = x0 - D.yyy;
                    i = mod289(i);
                    vec4 p = permute(permute(permute(
                                i.z + vec4(0.0, i1.z, i2.z, 1.0))
                              + i.y + vec4(0.0, i1.y, i2.y, 1.0))
                              + i.x + vec4(0.0, i1.x, i2.x, 1.0));
                    float n_ = 0.142857142857;
                    vec3  ns = n_ * D.wyz - D.xzx;
                    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
                    vec4 x_ = floor(j * ns.z);
                    vec4 y_ = floor(j - 7.0 * x_);
                    vec4 x = x_ *ns.x + ns.yyyy;
                    vec4 y = y_ *ns.x + ns.yyyy;
                    vec4 h = 1.0 - abs(x) - abs(y);
                    vec4 b0 = vec4(x.xy, y.xy);
                    vec4 b1 = vec4(x.zw, y.zw);
                    vec4 s0 = floor(b0)*2.0 + 1.0;
                    vec4 s1 = floor(b1)*2.0 + 1.0;
                    vec4 sh = -step(h, vec4(0.0));
                    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
                    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
                    vec3 p0 = vec3(a0.xy, h.x);
                    vec3 p1 = vec3(a0.zw, h.y);
                    vec3 p2 = vec3(a1.xy, h.z);
                    vec3 p3 = vec3(a1.zw, h.w);
                    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
                    p0 *= norm.x;
                    p1 *= norm.y;
                    p2 *= norm.z;
                    p3 *= norm.w;
                    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
                    m = m * m;
                    return 42.0 * dot( m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
                }

                void main() {
                    // Calculate view direction relative to the sphere surface
                    vec3 viewDir = normalize(vec3(0.0, 0.0, 1.0));
                    float ndotv = dot(vNormal, viewDir);
                    
                    // Inverse rim lighting (black center, glowing edge)
                    float rim = 1.0 - abs(ndotv);
                    
                    // Radial noise for the corona flare
                    float noise = snoise(normalize(vPosition) * 4.0 + vec3(0.0, 0.0, uTime * -2.0));
                    float flare = smoothstep(0.2, 0.8, noise) * rim;
                    
                    // Core bloom (whites out the center as camera approaches)
                    float coreBloom = smoothstep(0.7, 1.0, uProgress) * 2.0;
                    float exposure = max(0.0, coreBloom - abs(ndotv));
                    
                    // Plasma color mapping
                    vec3 color = mix(uColorPrimary * 0.2, uColorPrimary * 2.0, flare);
                    color += vec3(1.0) * pow(rim, 4.0); // Hot sharp edge
                    color = mix(color, vec3(1.0), exposure); // Bloom to white

                    // Alpha composition
                    float alpha = (pow(rim, 2.0) + flare * 0.5 + exposure) * uProgress * 2.0;

                    gl_FragColor = vec4(color, min(alpha, 1.0));
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.BackSide,
        });

        this.centralGlow = new THREE.Mesh(geometry, material);
        this.centralGlow.position.set(0, 0, -50);
        this.centralGlow.scale.setScalar(5);
        this.scene.add(this.centralGlow);
    }

    /**
     * Create iris vignette — fullscreen quad with circular cutout
     * Simulates looking through the orb as the camera zooms in
     */
    createIrisVignette() {
        const geometry = new THREE.PlaneGeometry(2, 2);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uProgress: { value: 0 },
                uIrisRadius: { value: 0.0 },
                uColorPrimary: { value: this.colors.primary.clone() },
                uAspect: { value: window.innerWidth / window.innerHeight },
                uTime: { value: 0 },
                uCenter: { value: new THREE.Vector2(this.portalAnchor.x, this.portalAnchor.y) },
                uLensDistortion: { value: 0 },
                uEdgeRefraction: { value: 0 },
                uChromaticSplit: { value: 0 },
                uIntakeStreaks: { value: 0 },
                uExposure: { value: 0 },
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position.xy, 0.0, 1.0);
                }
            `,
            fragmentShader: `
                varying vec2 vUv;
                uniform float uProgress;
                uniform float uIrisRadius;
                uniform vec3 uColorPrimary;
                uniform float uAspect;
                uniform float uTime;
                uniform vec2 uCenter;
                uniform float uLensDistortion;
                uniform float uEdgeRefraction;
                uniform float uChromaticSplit;
                uniform float uIntakeStreaks;
                uniform float uExposure;

                void main() {
                    vec2 center = vUv - uCenter;
                    center.x *= uAspect;
                    float dist = length(center);
                    float angle = atan(center.y, center.x);

                    float lensWarp = sin((dist * 16.0 - uTime * 5.0) + angle * 4.0) * 0.035 * uLensDistortion;
                    float warpedDist = max(0.0, dist + lensWarp);

                    // Radial tearing at the edge for violent breach
                    float tear = sin(angle * 22.0 + uTime * 18.0) * sin(angle * 9.0 - uTime * 12.0) * 0.06 * uProgress * uLensDistortion;

                    // Iris circular mask with tearing
                    float edgeWidth = 0.08 + uIrisRadius * 0.05;
                    float iris = smoothstep(uIrisRadius - edgeWidth + tear, uIrisRadius + edgeWidth + tear, warpedDist);

                    // Glow at the iris edge (the orb rim)
                    float edgeGlow = smoothstep(uIrisRadius + edgeWidth * 2.0, uIrisRadius, warpedDist)
                                   * smoothstep(uIrisRadius - edgeWidth * 2.0, uIrisRadius, warpedDist);
                    edgeGlow = pow(edgeGlow, 2.0);

                    // Subtle energy shimmer on the edge
                    float shimmer = sin(angle * 12.0 + uTime * 4.0) * 0.3 + 0.7;

                    // Speed Lines (High frequency radial noise stretched backwards)
                    float speedLineNoise = fract(sin(dot(vec2(angle, angle), vec2(12.9898, 78.233))) * 43758.5453);
                    float speedLineTaper = smoothstep(0.2, 1.0, warpedDist) * uProgress;
                    float speedLines = step(0.95, speedLineNoise + sin(uTime * 50.0 + angle * 100.0) * 0.1) * speedLineTaper * uIntakeStreaks;

                    // Chromatic Aberration (R/B channel split based on velocity)
                    float chromaOffset = uChromaticSplit * uProgress * warpedDist * 0.05;
                    float rDist = warpedDist - chromaOffset;
                    float bDist = warpedDist + chromaOffset;
                    
                    // Sample the "iris" mask for each channel to create RGB trailing fringes
                    float rIris = smoothstep(uIrisRadius - edgeWidth, uIrisRadius + edgeWidth, rDist);
                    float bIris = smoothstep(uIrisRadius - edgeWidth, uIrisRadius + edgeWidth, bDist);

                    // Base color compilation
                    vec3 color = vec3(0.0);
                    color += uColorPrimary * edgeGlow * shimmer * 2.0;
                    
                    // Add the chromatic fringe natively to the color
                    color.r += rIris * 0.5 * uProgress;
                    color.b += bIris * 0.5 * uProgress;
                    
                    color += mix(uColorPrimary, vec3(1.0), 0.8) * speedLines * 2.0; // Hot white speed lines

                    // Final alpha composition
                    float alpha = iris * uProgress;
                    alpha = max(alpha, edgeGlow * shimmer * uProgress * 0.5);
                    alpha = max(alpha, speedLines * uProgress); // Speed lines burn through

                    // Apply exposure blow-out from the orb flash
                    color = mix(color, vec3(1.0), uExposure);
                    alpha = max(alpha, uExposure);

                    gl_FragColor = vec4(color, alpha);
                }
            `,
            transparent: true,
            depthTest: false,
            depthWrite: false,
        });

        this.irisVignette = new THREE.Mesh(geometry, material);
        // Render on a separate ortho-like layer by placing it very close to camera
        this.irisVignette.renderOrder = 999;
        this.irisVignette.frustumCulled = false;
        this.scene.add(this.irisVignette);
    }

    /**
     * Apply profile-driven effect budget and renderer caps.
     * Can be called before or between plays.
     */
    applyQualityProfile(profile) {
        if (!profile) return;

        const resolved = profile.name ? profile : resolveWarpQualityProfile(profile);
        this.qualityProfile = resolved;

        const starCount = resolved.starCount ?? this.config.starCount;
        const spiralCount = resolved.spiralCount ?? this.config.spiralCount;
        const countsChanged = starCount !== this.config.starCount || spiralCount !== this.config.spiralCount;

        this.config.starCount = starCount;
        this.config.spiralCount = spiralCount;

        if (this.renderer) {
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, resolved.pixelRatioCap ?? 2));
        }

        if (this.scene && countsChanged && !this.isAnimating) {
            if (this.starTrails) {
                this.scene.remove(this.starTrails);
                this.starTrails.geometry?.dispose();
                this.starTrails.material?.dispose();
                this.starTrails = null;
            }
            if (this.energySpiral) {
                this.scene.remove(this.energySpiral);
                this.energySpiral.geometry?.dispose();
                this.energySpiral.material?.dispose();
                this.energySpiral = null;
            }
            this.createStarTrails();
            this.createEnergySpiral();
            this.applyThemeColors({
                chapterColor: this.colors.primary,
                accentColor: this.colors.accent,
            });
        }
    }

    /**
     * Set portal screen-space anchor (0-1 normalized).
     * This keeps iris + ring aligned with the selected orb.
     */
    setPortalAnchor(anchor = {}) {
        const x = Number.isFinite(anchor.x) ? anchor.x : 0.5;
        const y = Number.isFinite(anchor.y) ? anchor.y : 0.5;
        const radius = Number.isFinite(anchor.radius) ? anchor.radius : 0.16;

        this.portalAnchor = {
            x: Math.max(0.05, Math.min(0.95, x)),
            y: Math.max(0.05, Math.min(0.95, y)),
            radius: Math.max(0.03, Math.min(0.75, radius)),
        };

        if (this.irisVignette?.material?.uniforms?.uCenter) {
            this.irisVignette.material.uniforms.uCenter.value.set(this.portalAnchor.x, this.portalAnchor.y);
        }

        this.applyPortalAnchorToMeshes();
    }

    applyPortalAnchorToMeshes() {
        const ndcX = (this.portalAnchor.x - 0.5) * 2;
        const ndcY = (0.5 - this.portalAnchor.y) * 2;

        if (this.portalRing) {
            this.portalRing.position.x = ndcX * 4.2;
            this.portalRing.position.y = ndcY * 2.4;
        }
        if (this.centralGlow) {
            this.centralGlow.position.x = ndcX * 11;
            this.centralGlow.position.y = ndcY * 6;
        }
    }

    /**
     * High-level profile-based playback API used by the transition director.
     * Legacy play(duration, themeConfig) remains supported.
     */
    playProfile({
        duration = 4000,
        qualityProfile = 'High',
        themeConfig = null,
        portalAnchor = null,
        compositor = null,
    } = {}) {
        this.applyQualityProfile(qualityProfile);
        if (portalAnchor) {
            this.setPortalAnchor(portalAnchor);
        }
        this.externalCompositor = compositor || null;
        return this.play(duration, themeConfig);
    }

    // ═══════════════════════════════════════════════════════════════
    // PLAYBACK
    // ═══════════════════════════════════════════════════════════════

    /**
     * Play the warp transition with optional theme config
     * @param {number} duration - Duration in ms
     * @param {Object} [themeConfig] - Theme colors
     * @param {THREE.Color} [themeConfig.chapterColor] - Primary chapter color
     * @param {THREE.Color} [themeConfig.accentColor] - Accent/secondary color
     * @returns {Promise} Resolves when animation completes
     */
    play(duration = 8000, themeConfig = null) {
        return new Promise((resolve) => {
            if (!this.scene) {
                this.init();
            }

            this.externalCompositor?.attachWarpContainer?.(this.container);
            this.setPortalAnchor(this.portalAnchor);

            // Apply theme colors if provided
            if (themeConfig) {
                this.applyThemeColors(themeConfig);
            }

            this.duration = duration;
            this.startTime = performance.now();
            this.isAnimating = true;
            this.onComplete = resolve;

            this.resetUniforms();

            this.container.style.opacity = '0';
            this.container.style.transition = 'none';

            this.animate();

            console.log(`[WarpTransition] Playing orb-portal warp (${duration}ms)`);
        });
    }

    /**
     * Apply theme colors to all effect materials
     */
    applyThemeColors(config) {
        const primary = config.chapterColor instanceof THREE.Color
            ? config.chapterColor
            : new THREE.Color(config.chapterColor || 0x00ccff);

        const accent = config.accentColor instanceof THREE.Color
            ? config.accentColor
            : new THREE.Color(config.accentColor || 0xff55aa);

        // Create a lighter secondary from primary
        const secondary = primary.clone();
        secondary.offsetHSL(0.1, 0, 0.2); // Shift hue slightly, lighten

        this.colors.primary = primary;
        this.colors.secondary = secondary;
        this.colors.accent = accent;

        // Update all material uniforms
        const updates = [
            [this.starTrails?.material, { uColorPrimary: primary, uColorSecondary: secondary }],
            [this.energySpiral?.material, { uColorPrimary: primary, uColorSecondary: secondary }],
            [this.portalRing?.material, { uColorPrimary: primary, uColorAccent: accent }],
            [this.centralGlow?.material, { uColorPrimary: primary }],
            [this.irisVignette?.material, { uColorPrimary: primary }],
            [this.exitFlash?.material, { uColorPrimary: primary }],
        ];

        for (const [mat, colorMap] of updates) {
            if (!mat?.uniforms) continue;
            for (const [key, color] of Object.entries(colorMap)) {
                if (mat.uniforms[key]) {
                    mat.uniforms[key].value.copy(color);
                }
            }
        }

        console.log(`[WarpTransition] Applied theme: primary=#${primary.getHexString()}, accent=#${accent.getHexString()}`);
    }

    /**
     * Reset all shader uniforms
     */
    resetUniforms() {
        if (this.starTrails) {
            this.starTrails.material.uniforms.uTime.value = 0;
            this.starTrails.material.uniforms.uProgress.value = 0;
            this.starTrails.material.uniforms.uStretch.value = 1;
        }
        if (this.energySpiral) {
            this.energySpiral.material.uniforms.uTime.value = 0;
            this.energySpiral.material.uniforms.uProgress.value = 0;
        }
        if (this.portalRing) {
            this.portalRing.material.uniforms.uTime.value = 0;
            this.portalRing.material.uniforms.uProgress.value = 0;
            this.portalRing.material.uniforms.uPhase.value = 0;
        }
        if (this.centralGlow) {
            this.centralGlow.material.uniforms.uTime.value = 0;
            this.centralGlow.material.uniforms.uProgress.value = 0;
        }
        if (this.irisVignette) {
            this.irisVignette.material.uniforms.uProgress.value = 0;
            this.irisVignette.material.uniforms.uIrisRadius.value = 0;
            this.irisVignette.material.uniforms.uTime.value = 0;
            this.irisVignette.material.uniforms.uAspect.value = window.innerWidth / window.innerHeight;
            this.irisVignette.material.uniforms.uLensDistortion.value = 0;
            this.irisVignette.material.uniforms.uEdgeRefraction.value = 0;
            this.irisVignette.material.uniforms.uChromaticSplit.value = 0;
            this.irisVignette.material.uniforms.uIntakeStreaks.value = 0;
            if (this.irisVignette.material.uniforms.uCenter) {
                this.irisVignette.material.uniforms.uCenter.value.set(this.portalAnchor.x, this.portalAnchor.y);
            }
        }
        if (this.exitFlash) {
            this.exitFlash.material.uniforms.uFlashIntensity.value = 0;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // ANIMATION LOOP
    // ═══════════════════════════════════════════════════════════════

    animate() {
        if (!this.isAnimating) return;

        this.animationId = requestAnimationFrame(() => this.animate());

        const elapsed = performance.now() - this.startTime;
        const rawProgress = Math.min(elapsed / this.duration, 1);
        const progress = this.easeInOutCubic(rawProgress);
        const time = elapsed / 1000;

        // ── Phase calculation ──
        // Phase 1: Iris focus (0-30%)
        // Phase 2: Portal expansion (20-55%)
        // Phase 3: Full warp + exit flash (45-100%)
        const phase1 = Math.min(rawProgress / 0.30, 1);           // 0→1 over first 30%
        const phase2 = Math.max(0, Math.min((rawProgress - 0.20) / 0.35, 1)); // 0→1 over 20-55%
        const phase3 = Math.max(0, Math.min((rawProgress - 0.45) / 0.55, 1)); // 0→1 over 45-100%

        // ── Update effects ──
        this.updateIrisVignette(time, rawProgress, phase1);
        this.updatePortalRing(time, rawProgress, phase2);
        this.updateStarTrails(time, progress, phase3);
        this.updateEnergySpiral(time, rawProgress);
        this.updateCentralGlow(time, progress, phase3);
        this.updateCamera(rawProgress, progress);

        // ── Container opacity (Entrance + Dispersion Exit) ──
        let opacity;
        if (rawProgress < 0.12) {
            opacity = (rawProgress / 0.12) ** 1.5;
        } else if (rawProgress < 0.82) {
            opacity = 1;
        } else {
            // Smooth cinematic dispersion fade out to reveal the board cleanly
            const fadeOut = (rawProgress - 0.82) / 0.18;
            opacity = 1 - (fadeOut * fadeOut);
        }
        this.container.style.opacity = String(Math.max(0, opacity));

        this.renderer.render(this.scene, this.camera);

        if (rawProgress >= 1) {
            this.stop();
        }
    }

    easeInOutCubic(t) {
        return t < 0.5
            ? 4 * t * t * t
            : 1 - (-2 * t + 2) ** 3 / 2;
    }

    // ═══════════════════════════════════════════════════════════════
    // EFFECT UPDATES
    // ═══════════════════════════════════════════════════════════════

    updateIrisVignette(time, rawProgress, phase1) {
        if (!this.irisVignette) return;

        const mat = this.irisVignette.material;
        mat.uniforms.uTime.value = time;
        const anchorRadius = this.portalAnchor?.radius ?? 0.16;
        const intakeStrength = this.qualityProfile.intakeStrength ?? 1;
        const chromaScale = this.qualityProfile.chromaticSplitScale ?? 1;
        const streakEnabled = this.qualityProfile.enableDebrisStreaks !== false;

        // Iris starts large, shrinks to focus point, then opens wide
        let irisRadius;
        if (rawProgress < 0.15) {
            // Shrink from full screen to small aperture
            const focusRadius = Math.max(0.18, anchorRadius * 1.9);
            irisRadius = 2.0 - (rawProgress / 0.15) * (2.0 - focusRadius);
        } else if (rawProgress < 0.35) {
            // Hold tight
            const focusRadius = Math.max(0.16, anchorRadius * 1.4);
            irisRadius = focusRadius - ((rawProgress - 0.15) / 0.20) * 0.12;
        } else if (rawProgress < 0.60) {
            // Expand rapidly as portal opens
            irisRadius = 0.25 + ((rawProgress - 0.35) / 0.25) ** 0.7 * 2.5;
        } else {
            irisRadius = 3.0; // Fully open
        }

        mat.uniforms.uIrisRadius.value = irisRadius;

        // Fade in during Phase 1, fade out once iris fully opens
        let irisAlpha;
        if (rawProgress < 0.08) {
            irisAlpha = rawProgress / 0.08;
        } else if (rawProgress < 0.55) {
            irisAlpha = 1.0;
        } else {
            irisAlpha = Math.max(0, 1.0 - (rawProgress - 0.55) / 0.15);
        }
        mat.uniforms.uProgress.value = irisAlpha;

        // Orb intake controls: strongest in early phase, easing out before full tunnel.
        const intakeFalloff = Math.max(0, 1 - (phase1 * 1.1));
        mat.uniforms.uLensDistortion.value = intakeFalloff * 1.35 * intakeStrength; // Intensify distortion
        mat.uniforms.uEdgeRefraction.value = intakeFalloff * 1.25 * intakeStrength; // Intensify refraction
        mat.uniforms.uChromaticSplit.value = intakeFalloff * 1.15 * chromaScale;    // Intensify split
        mat.uniforms.uIntakeStreaks.value = streakEnabled
            ? ((intakeFalloff ** 0.6) * intakeStrength * 1.6) // More violent intake
            : 0;

        // Start with a massive exposure blowout to seamlessly emerge from the bright orb
        mat.uniforms.uExposure.value = rawProgress < 0.15 ? Math.pow(1.0 - (rawProgress / 0.15), 3.0) : 0.0;
    }

    updatePortalRing(time, rawProgress, phase2) {
        if (!this.portalRing) return;

        const mat = this.portalRing.material;
        mat.uniforms.uTime.value = time;

        // Portal appears during Phase 2
        const portalProgress = Math.max(0, Math.min((rawProgress - 0.20) / 0.10, 1));
        mat.uniforms.uProgress.value = portalProgress;

        // Phase controls how large the ring has grown
        const phaseEased = phase2 ** 0.6; // Ease for smooth expansion
        mat.uniforms.uPhase.value = phaseEased;

        // Rotate the ring for energy effect
        this.portalRing.rotation.z = time * 0.5;
    }

    updateStarTrails(time, progress, phase3) {
        if (!this.starTrails) return;

        // Stars ramp up during Phase 3
        const starProgress = phase3;
        const speed = 1 + starProgress * 3;
        const stretchMultiplier = this.qualityProfile.stretchMultiplier ?? 1;

        this.starTrails.material.uniforms.uTime.value = time * speed;
        this.starTrails.material.uniforms.uProgress.value = starProgress;
        this.starTrails.material.uniforms.uStretch.value = 1 + starProgress * 2.5 * stretchMultiplier;
    }

    updateEnergySpiral(time, rawProgress) {
        if (!this.energySpiral) return;

        // The FBM shader handles acceleration and depth fading internally
        this.energySpiral.material.uniforms.uTime.value = time;
        this.energySpiral.material.uniforms.uProgress.value = rawProgress;
    }

    updateCentralGlow(time, progress, phase3) {
        if (!this.centralGlow) return;

        this.centralGlow.material.uniforms.uTime.value = time;
        this.centralGlow.material.uniforms.uProgress.value = phase3;

        // Grow as we approach, faster than before
        const scale = 5 + phase3 * 20;
        this.centralGlow.scale.setScalar(scale);
        this.centralGlow.position.z = -50 + phase3 * 48;
    }

    updateCamera(rawProgress, progress) {
        // Continuous Cinematic Shot
        // Phase 1: Ignition flash hands over to max speed (0 -> 0.18 is hidden by flash)
        // Phase 2: Frictionless high velocity glide
        // Phase 3: Deceleration and dispersion

        // ── Forward Velocity (Z) ──
        let zPos;
        if (rawProgress < 0.18) {
            zPos = 5; // Hold at entrance
        } else if (rawProgress < 0.85) {
            // Instantaneous high-velocity entry, sustained linear glide (no ramp)
            const warpProgress = (rawProgress - 0.18) / 0.67;
            zPos = 5 + warpProgress * 65; // Much faster glide
        } else {
            // Decelerating arrival dispersion
            const arriveProgress = (rawProgress - 0.85) / 0.15;
            // Smooth braking
            const easeOut = arriveProgress * (2 - arriveProgress);
            zPos = 5 + 65 + easeOut * 12;
        }

        // NO camera shake! True speed is frictionless.
        this.camera.position.x = 0;
        this.camera.position.y = 0;
        this.camera.position.z = zPos;

        // ── Camera Roll (Z-rotation) ──
        // Single, deep continuous banking motion
        let roll;
        if (rawProgress < 0.18) {
            roll = 0;
        } else if (rawProgress < 0.50) {
            // Bank deep into the glide
            const rollIn = (rawProgress - 0.18) / 0.32;
            roll = this.easeInOutCubic(rollIn) * 0.45; // Very deep, smooth roll
        } else {
            // Unwind slowly towards arrival frame
            const rollOut = (rawProgress - 0.50) / 0.50;
            // Slow ease out
            roll = 0.45 * (1 - (rollOut * (2 - rollOut)));
        }
        this.camera.rotation.z = roll;

        // ── FOV ──
        let fov;
        if (rawProgress < 0.18) {
            fov = 55;
        } else if (rawProgress < 0.85) {
            // Sharp kick upon clearing the flash, sustaining wide angle for speed
            const kickProgress = Math.min(1, (rawProgress - 0.18) / 0.10);
            const wideOpen = 55 + this.easeInOutCubic(kickProgress) * 48; // Peak at 103

            // Soft breathe at high speed
            const breath = Math.sin((rawProgress - 0.28) * Math.PI * 2) * 2;
            fov = wideOpen + breath;
        } else {
            // Hard deceleration brake (FOV contracts) to hit perfectly flat for board handover
            const brakeProgress = (rawProgress - 0.85) / 0.15;
            const easeIn = brakeProgress * brakeProgress;
            // Target roughly 60 degrees for a clean orthographic-like board handover
            fov = 103 - easeIn * 43;
        }
        this.camera.fov = fov;
        this.camera.updateProjectionMatrix();
    }

    // ═══════════════════════════════════════════════════════════════
    // LIFECYCLE
    // ═══════════════════════════════════════════════════════════════

    /**
     * Render one hidden frame to prewarm shaders/material programs.
     */
    prewarmFrame() {
        if (!this.scene) {
            this.init();
        }
        if (!this.renderer || !this.scene || !this.camera) return;

        const previousOpacity = this.container.style.opacity;
        this.container.style.opacity = '0';
        this.resetUniforms();
        this.renderer.render(this.scene, this.camera);
        this.container.style.opacity = previousOpacity;
    }

    stop() {
        this.isAnimating = false;

        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }

        // Do NOT hide the container here.
        // The exit flash is covering the screen at this point.
        // OdysseyMode will crossfade from flash → gameplay and then hide us.

        if (this.onComplete) {
            this.onComplete();
            this.onComplete = null;
        }

        console.log('[WarpTransition] Complete (exit flash holding)');
    }

    /**
     * Called by OdysseyMode after gameplay is revealed to hide the warp container
     */
    hideContainer() {
        if (this.container) {
            this.container.style.transition = 'opacity 0.6s ease-out';
            this.container.style.opacity = '0';
            // Clean up transition style after fade
            setTimeout(() => {
                if (this.container) {
                    this.container.style.transition = 'none';
                }
            }, 700);
        }
    }

    onResize() {
        if (!this.camera || !this.renderer) return;

        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.qualityProfile.pixelRatioCap ?? 2));

        if (this.irisVignette?.material?.uniforms?.uAspect) {
            this.irisVignette.material.uniforms.uAspect.value = window.innerWidth / window.innerHeight;
        }
        if (this.irisVignette?.material?.uniforms?.uCenter) {
            this.irisVignette.material.uniforms.uCenter.value.set(this.portalAnchor.x, this.portalAnchor.y);
        }
        this.applyPortalAnchorToMeshes();
    }

    dispose() {
        this.stop();

        window.removeEventListener('resize', this.resizeHandler);

        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }

        if (this.renderer) {
            this.renderer.dispose();
        }

        [this.starTrails, this.energySpiral, this.centralGlow, this.irisVignette, this.portalRing, this.exitFlash].forEach((obj) => {
            if (obj) {
                obj.geometry?.dispose();
                obj.material?.dispose();
            }
        });

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.container = null;

        console.log('[WarpTransition] Disposed');
    }
}

export default WarpTransitionRenderer;
