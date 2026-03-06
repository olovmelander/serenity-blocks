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
        this.createExitFlash();
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

                uniform float uTime;
                uniform float uProgress;
                uniform float uStretch;

                void main() {
                    vColorMix = color.r;

                    vec3 pos = position;
                    float speed = aSpeed * (0.5 + uProgress * 2.5);
                    pos.z = mod(pos.z + uTime * speed * 30.0 + aOffset, 100.0) - 100.0;

                    float stretch = 1.0 + uStretch * uProgress * 10.0;
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
                uniform float uProgress;
                uniform vec3 uColorPrimary;
                uniform vec3 uColorSecondary;
                uniform vec3 uColorWhite;

                void main() {
                    vec2 center = gl_PointCoord - 0.5;
                    float stretch = 1.0 + uProgress * 3.0;
                    center.x *= stretch;
                    float dist = length(center);
                    if (dist > 0.5) discard;

                    float alpha = (1.0 - dist * 2.0) * vAlpha;
                    alpha = pow(alpha, 0.7);

                    // Blend theme colors based on stored mix factor
                    vec3 color;
                    if (vColorMix < 0.5) {
                        color = mix(uColorWhite, uColorPrimary, vColorMix * 2.0);
                    } else {
                        color = mix(uColorPrimary, uColorSecondary, (vColorMix - 0.5) * 2.0);
                    }
                    color *= (1.0 + uProgress * 0.5);

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
     * Create energy spiral with theme gradient
     */
    createEnergySpiral() {
        const count = this.config.spiralCount;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const tValues = new Float32Array(count);
        const sizes = new Float32Array(count);
        const phases = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;
            const t = i / count;
            const z = -t * this.config.tunnelLength;
            const spiralAngle = t * Math.PI * 20 + Math.random() * 0.5;
            const radius = 2 + t * 8 + Math.random() * 2;

            positions[i3] = Math.cos(spiralAngle) * radius;
            positions[i3 + 1] = Math.sin(spiralAngle) * radius;
            positions[i3 + 2] = z;

            tValues[i] = t;
            sizes[i] = 2 + Math.random() * 4;
            phases[i] = Math.random() * Math.PI * 2;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aT', new THREE.BufferAttribute(tValues, 1));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uProgress: { value: 0 },
                uColorPrimary: { value: this.colors.primary.clone() },
                uColorSecondary: { value: this.colors.secondary.clone() },
            },
            vertexShader: `
                attribute float size;
                attribute float aT;
                attribute float aPhase;

                varying float vT;
                varying float vAlpha;

                uniform float uTime;
                uniform float uProgress;

                void main() {
                    vT = aT;

                    vec3 pos = position;
                    float angle = atan(pos.y, pos.x) + uTime * 2.5 + aPhase;
                    float radius = length(pos.xy);

                    pos.x = cos(angle) * radius;
                    pos.y = sin(angle) * radius;
                    pos.z = mod(pos.z + uTime * 18.0, 100.0) - 100.0;

                    float pulse = 1.0 + sin(uTime * 4.0 + aPhase) * 0.25;
                    pos.xy *= pulse;

                    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                    gl_PointSize = size * (300.0 / -mvPosition.z) * (0.5 + uProgress);
                    vAlpha = smoothstep(100.0, 5.0, -mvPosition.z) * uProgress;

                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying float vT;
                varying float vAlpha;
                uniform vec3 uColorPrimary;
                uniform vec3 uColorSecondary;

                void main() {
                    vec2 center = gl_PointCoord - 0.5;
                    float dist = length(center);
                    if (dist > 0.5) discard;

                    float alpha = (1.0 - dist * 2.0) * vAlpha;
                    vec3 color = mix(uColorPrimary, uColorSecondary, vT) * 1.5;

                    gl_FragColor = vec4(color, alpha * 0.8);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.energySpiral = new THREE.Points(geometry, material);
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
                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                varying vec3 vNormal;
                uniform float uTime;
                uniform float uProgress;
                uniform vec3 uColorPrimary;

                void main() {
                    float rim = 1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0)));
                    rim = pow(rim, 2.0);

                    // White core blending to chapter color at edges
                    vec3 color = mix(vec3(1.0), uColorPrimary, rim);

                    float pulse = 0.8 + sin(uTime * 5.0) * 0.2;
                    float alpha = rim * pulse * uProgress * 2.5;

                    gl_FragColor = vec4(color * 2.0, alpha);
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

                void main() {
                    vec2 center = vUv - uCenter;
                    center.x *= uAspect;
                    float dist = length(center);
                    float angle = atan(center.y, center.x);

                    float lensWarp = sin((dist * 16.0 - uTime * 5.0) + angle * 4.0) * 0.035 * uLensDistortion;
                    float warpedDist = max(0.0, dist + lensWarp);

                    // Iris circular mask
                    float edgeWidth = 0.08 + uIrisRadius * 0.05;
                    float iris = smoothstep(uIrisRadius - edgeWidth, uIrisRadius + edgeWidth, warpedDist);

                    // Glow at the iris edge (the orb rim)
                    float edgeGlow = smoothstep(uIrisRadius + edgeWidth * 2.0, uIrisRadius, warpedDist)
                                   * smoothstep(uIrisRadius - edgeWidth * 2.0, uIrisRadius, warpedDist);
                    edgeGlow = pow(edgeGlow, 2.0);

                    // Subtle energy shimmer on the edge
                    float shimmer = sin(angle * 12.0 + uTime * 4.0) * 0.3 + 0.7;

                    // Portal-edge refraction/chromatic split around the aperture
                    float edgeDist = abs(warpedDist - uIrisRadius);
                    float edgeBand = 1.0 - smoothstep(0.0, edgeWidth * 1.7, edgeDist);
                    float refraction = edgeBand * uEdgeRefraction * uProgress;

                    vec3 chroma = vec3(
                        sin((warpedDist + uTime * 0.9) * 26.0 + angle * 1.3),
                        sin((warpedDist + uTime * 1.1) * 24.0 + angle * 1.7 + 2.1),
                        sin((warpedDist + uTime * 1.3) * 22.0 + angle * 1.9 + 4.2)
                    ) * 0.5 + 0.5;

                    // Inward debris streaks toward the orb center
                    float debrisWave = sin(angle * 42.0 + uTime * 14.0 - warpedDist * 120.0);
                    float debrisMask = smoothstep(0.72, 1.0, debrisWave) * exp(-warpedDist * 9.0);
                    float debris = debrisMask * uIntakeStreaks * uProgress;

                    // Dark vignette outside the iris
                    vec3 color = vec3(0.0);
                    color += uColorPrimary * edgeGlow * shimmer * 2.0;
                    color += chroma * refraction * uChromaticSplit * 0.45;
                    color += mix(uColorPrimary, vec3(1.0), 0.45) * debris * 2.3;

                    float alpha = iris * uProgress;
                    alpha = max(alpha, edgeGlow * shimmer * uProgress * 0.5);
                    alpha = max(alpha, debris * 0.45);

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
     * Create exit flash — fullscreen quad that whites-out at end of warp.
     * This ensures zero gap between warp and gameplay reveal.
     */
    createExitFlash() {
        const geometry = new THREE.PlaneGeometry(2, 2);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uFlashIntensity: { value: 0 },
                uColorPrimary: { value: this.colors.primary.clone() },
            },
            vertexShader: `
                void main() {
                    gl_Position = vec4(position.xy, 0.0, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uFlashIntensity;
                uniform vec3 uColorPrimary;

                void main() {
                    // Blend from chapter color to white as intensity increases
                    vec3 flashColor = mix(uColorPrimary * 1.5, vec3(1.0), uFlashIntensity * 0.6);
                    gl_FragColor = vec4(flashColor, uFlashIntensity);
                }
            `,
            transparent: true,
            depthTest: false,
            depthWrite: false,
        });

        this.exitFlash = new THREE.Mesh(geometry, material);
        this.exitFlash.renderOrder = 1000; // Render on top of everything
        this.exitFlash.frustumCulled = false;
        this.scene.add(this.exitFlash);
    }

    /**
     * Update exit flash — ramps to full white at end of warp
     */
    updateExitFlash(rawProgress) {
        if (!this.exitFlash) return;

        let intensity;
        if (rawProgress < 0.75) {
            // No flash yet
            intensity = 0;
        } else if (rawProgress < 0.92) {
            // Ramp up aggressively
            const ramp = (rawProgress - 0.75) / 0.17;
            intensity = ramp ** (this.qualityProfile.flashGamma || 2.5); // Aggressive power curve
        } else {
            // Hold at full white
            intensity = 1;
        }

        this.exitFlash.material.uniforms.uFlashIntensity.value = intensity;
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
        this.updateEnergySpiral(time, progress, phase2, phase3);
        this.updateCentralGlow(time, progress, phase3);
        this.updateExitFlash(rawProgress);
        this.updateCamera(rawProgress, progress);

        // ── Container opacity ──
        // Quick fade in at start, then HOLD at full opacity throughout.
        // No fade-out! The exit flash covers the screen at the end,
        // and OdysseyMode handles the crossfade to gameplay.
        let opacity;
        if (rawProgress < 0.12) {
            opacity = (rawProgress / 0.12) ** 1.5;
        } else {
            opacity = 1;
        }
        this.container.style.opacity = String(opacity);

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
        mat.uniforms.uLensDistortion.value = intakeFalloff * 1.05 * intakeStrength;
        mat.uniforms.uEdgeRefraction.value = intakeFalloff * 0.95 * intakeStrength;
        mat.uniforms.uChromaticSplit.value = intakeFalloff * 0.75 * chromaScale;
        mat.uniforms.uIntakeStreaks.value = streakEnabled
            ? ((intakeFalloff ** 0.7) * intakeStrength)
            : 0;
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

    updateEnergySpiral(time, progress, phase2, phase3) {
        if (!this.energySpiral) return;

        // Spiral starts during portal phase, intensifies during warp
        const spiralProgress = Math.max(phase2 * 0.5, phase3);

        this.energySpiral.material.uniforms.uTime.value = time;
        this.energySpiral.material.uniforms.uProgress.value = Math.min(spiralProgress * 1.2, 1);
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
        // Phase 1: Subtle pull forward (looking through orb)
        // Phase 2: Accelerate into tunnel (portal crossing)
        // Phase 3: Full speed warp + deceleration at end

        let zPos;
        if (rawProgress < 0.30) {
            // Slow creep forward
            zPos = rawProgress / 0.30 * 5;
        } else if (rawProgress < 0.85) {
            // Accelerating warp
            const warpProgress = (rawProgress - 0.30) / 0.55;
            zPos = 5 + warpProgress ** 1.5 * 35;
        } else {
            // Decelerate as we arrive (exit flash takes over)
            const arriveProgress = (rawProgress - 0.85) / 0.15;
            zPos = 5 + 35 + arriveProgress * 5;
        }

        // Camera shake — builds during warp, fades near end
        let shakeIntensity;
        if (rawProgress < 0.25) {
            shakeIntensity = rawProgress * 0.15;
        } else if (rawProgress < 0.80) {
            shakeIntensity = Math.sin((rawProgress - 0.25) / 0.55 * Math.PI) * 0.5;
        } else {
            // Shake dies off as we arrive
            shakeIntensity = Math.max(0, (1 - (rawProgress - 0.80) / 0.20) * 0.3);
        }
        shakeIntensity *= this.qualityProfile.shakeMultiplier ?? 1;
        const shakeX = Math.sin(rawProgress * Math.PI * 14) * shakeIntensity;
        const shakeY = Math.cos(rawProgress * Math.PI * 11) * shakeIntensity * 0.6;

        this.camera.position.x = shakeX;
        this.camera.position.y = shakeY;
        this.camera.position.z = zPos;

        // ── Camera Roll (Z-rotation) ──
        // Twist into the vortex during Phase 2, unwind during Phase 3
        let roll;
        if (rawProgress < 0.20) {
            // No roll during iris focus
            roll = 0;
        } else if (rawProgress < 0.55) {
            // Twist into vortex as portal opens
            const rollIn = (rawProgress - 0.20) / 0.35;
            roll = this.easeInOutCubic(rollIn) * 0.15; // ~8.5 degrees max
        } else if (rawProgress < 0.85) {
            // Slowly unwind during warp
            const rollOut = (rawProgress - 0.55) / 0.30;
            roll = 0.15 * (1 - this.easeInOutCubic(rollOut));
        } else {
            roll = 0;
        }
        this.camera.rotation.z = roll;

        // ── FOV ──
        // Narrow start (orb focus), sharp kick at portal crossing, then widens for speed
        let fov;
        if (rawProgress < 0.18) {
            // Narrow — focused through orb
            fov = 55 + rawProgress / 0.18 * 10;
        } else if (rawProgress < 0.35) {
            // SHARP kick as portal ring crosses camera
            const kick = (rawProgress - 0.18) / 0.17;
            fov = 65 + this.easeInOutCubic(kick) * 35;
        } else if (rawProgress < 0.85) {
            // Warp speed — wide FOV with subtle breath
            const breath = Math.sin((rawProgress - 0.35) * Math.PI * 3) * 3;
            fov = 100 + ((rawProgress - 0.35) / 0.50) * 15 + breath;
        } else {
            // Slight narrow as we arrive (compression before flash)
            const compress = (rawProgress - 0.85) / 0.15;
            fov = 115 - compress * 20;
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
