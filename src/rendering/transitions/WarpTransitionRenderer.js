/**
 * @fileoverview WarpTransitionRenderer - Cinematic Three.js level transition
 *
 * Creates a mesmerizing warp tunnel effect for level transitions.
 * Features: star trails, energy spiral, light beams, and smooth reveal.
 *
 * Phase 4 - Odyssey Mode Enhanced Transitions
 */

import * as THREE from 'three';

/**
 * WarpTransitionRenderer - Creates stunning warp transitions
 */
export class WarpTransitionRenderer {
    constructor() {
        this.container = null;
        this.scene = null;
        this.camera = null;
        this.renderer = null;

        // Particle systems
        this.starTrails = null;
        this.energySpiral = null;
        this.lightBeams = null;
        this.centralGlow = null;

        // Animation state
        this.isAnimating = false;
        this.animationId = null;
        this.startTime = 0;
        this.duration = 3000; // 3 seconds for full effect
        this.onComplete = null;

        // Configuration
        this.config = {
            starCount: 5000,
            spiralCount: 2000,
            beamCount: 24,
            tunnelLength: 100,
            tunnelRadius: 20,
            colors: {
                primary: new THREE.Color(0x00ccff), // Cyan
                secondary: new THREE.Color(0x8855ff), // Purple
                accent: new THREE.Color(0xff55aa), // Pink
                white: new THREE.Color(0xffffff), // White
            },
        };

        console.log('[WarpTransition] Cinematic renderer created');
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
            z-index: 10001;
            pointer-events: none;
            opacity: 0;
            background: transparent;
        `;
        document.body.appendChild(this.container);

        // Scene
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x000011, 0.015);

        // Camera - positioned at tunnel entrance, looking forward
        this.camera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.1, 500);
        this.camera.position.set(0, 0, 0);
        this.camera.lookAt(0, 0, -50);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(0x000000, 0);
        this.container.appendChild(this.renderer.domElement);

        // Create all effects
        this.createStarTrails();
        this.createEnergySpiral();
        this.createLightBeams();
        this.createCentralGlow();

        // Handle resize
        this.resizeHandler = this.onResize.bind(this);
        window.addEventListener('resize', this.resizeHandler);

        console.log('[WarpTransition] Scene initialized');
    }

    /**
     * Create hyperspace star trails - long streaking stars
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

            // Cylindrical distribution around tunnel
            const angle = Math.random() * Math.PI * 2;
            const radius = 3 + Math.random() * this.config.tunnelRadius;
            const z = -Math.random() * this.config.tunnelLength;

            positions[i3] = Math.cos(angle) * radius;
            positions[i3 + 1] = Math.sin(angle) * radius;
            positions[i3 + 2] = z;

            // Blend colors - mostly white/cyan with hints of purple
            const colorMix = Math.random();
            let color;
            if (colorMix < 0.6) {
                color = this.config.colors.white;
            } else if (colorMix < 0.85) {
                color = this.config.colors.primary;
            } else {
                color = this.config.colors.secondary;
            }

            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

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
            },
            vertexShader: `
                attribute float size;
                attribute vec3 color;
                attribute float aSpeed;
                attribute float aOffset;
                
                varying vec3 vColor;
                varying float vAlpha;
                
                uniform float uTime;
                uniform float uProgress;
                uniform float uStretch;

                void main() {
                    vColor = color;
                    
                    vec3 pos = position;
                    
                    // Move stars toward camera (hyperspace effect)
                    float speed = aSpeed * (0.5 + uProgress * 2.0);
                    pos.z = mod(pos.z + uTime * speed * 30.0 + aOffset, 100.0) - 100.0;
                    
                    // Stretch stars as speed increases (motion blur effect)
                    float stretch = 1.0 + uStretch * uProgress * 8.0;
                    
                    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                    
                    // Size based on distance and stretch
                    float dist = -mvPosition.z;
                    gl_PointSize = size * (400.0 / dist) * stretch;
                    
                    // Fade based on distance
                    vAlpha = smoothstep(100.0, 10.0, dist) * (0.3 + uProgress * 0.7);
                    
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                varying float vAlpha;
                uniform float uStretch;
                uniform float uProgress;

                void main() {
                    vec2 center = gl_PointCoord - 0.5;
                    
                    // Elongate based on stretch (horizontal streaking)
                    float stretch = 1.0 + uProgress * 3.0;
                    center.x *= stretch;
                    
                    float dist = length(center);
                    if (dist > 0.5) discard;
                    
                    // Soft glow with bright center
                    float alpha = (1.0 - dist * 2.0) * vAlpha;
                    alpha = pow(alpha, 0.7);
                    
                    // Add bloom glow
                    vec3 color = vColor * (1.0 + uProgress * 0.5);
                    
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
     * Create energy spiral - spinning particles around the tunnel
     */
    createEnergySpiral() {
        const count = this.config.spiralCount;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const phases = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;
            const t = i / count;

            // Spiral along tunnel
            const z = -t * this.config.tunnelLength;
            const spiralAngle = t * Math.PI * 16 + Math.random() * 0.5;
            const radius = 2 + t * 8 + Math.random() * 2;

            positions[i3] = Math.cos(spiralAngle) * radius;
            positions[i3 + 1] = Math.sin(spiralAngle) * radius;
            positions[i3 + 2] = z;

            // Color gradient from cyan to purple
            const color = new THREE.Color().lerpColors(
                this.config.colors.primary,
                this.config.colors.secondary,
                t,
            );
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            sizes[i] = 2 + Math.random() * 4;
            phases[i] = Math.random() * Math.PI * 2;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uProgress: { value: 0 },
            },
            vertexShader: `
                attribute float size;
                attribute vec3 color;
                attribute float aPhase;
                
                varying vec3 vColor;
                varying float vAlpha;
                
                uniform float uTime;
                uniform float uProgress;

                void main() {
                    vColor = color;
                    
                    vec3 pos = position;
                    
                    // Rotate spiral over time
                    float angle = atan(pos.y, pos.x) + uTime * 2.0 + aPhase;
                    float radius = length(pos.xy);
                    
                    pos.x = cos(angle) * radius;
                    pos.y = sin(angle) * radius;
                    
                    // Move toward camera
                    pos.z = mod(pos.z + uTime * 15.0, 100.0) - 100.0;
                    
                    // Pulse radius
                    float pulse = 1.0 + sin(uTime * 4.0 + aPhase) * 0.2;
                    pos.xy *= pulse;
                    
                    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                    
                    gl_PointSize = size * (300.0 / -mvPosition.z) * (0.5 + uProgress);
                    
                    vAlpha = smoothstep(100.0, 5.0, -mvPosition.z) * uProgress;
                    
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                varying float vAlpha;

                void main() {
                    vec2 center = gl_PointCoord - 0.5;
                    float dist = length(center);
                    if (dist > 0.5) discard;
                    
                    float alpha = (1.0 - dist * 2.0) * vAlpha;
                    vec3 color = vColor * 1.5;
                    
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
     * Create light beams - radial rays from center
     */
    createLightBeams() {
        const count = this.config.beamCount;
        const group = new THREE.Group();

        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2;

            const geometry = new THREE.PlaneGeometry(0.3, 80);
            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uProgress: { value: 0 },
                    uColor: { value: this.config.colors.primary.clone() },
                },
                vertexShader: `
                    varying vec2 vUv;
                    void main() {
                        vUv = uv;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    varying vec2 vUv;
                    uniform float uTime;
                    uniform float uProgress;
                    uniform vec3 uColor;

                    void main() {
                        // Fade from center outward
                        float fade = 1.0 - abs(vUv.x - 0.5) * 2.0;
                        float lengthFade = smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.7, vUv.y);
                        
                        // Pulse
                        float pulse = sin(uTime * 3.0 + vUv.y * 10.0) * 0.3 + 0.7;
                        
                        float alpha = fade * lengthFade * pulse * uProgress * 0.4;
                        
                        gl_FragColor = vec4(uColor, alpha);
                    }
                `,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            });

            const beam = new THREE.Mesh(geometry, material);
            beam.position.set(0, 0, -40);
            beam.rotation.z = angle;
            beam.rotation.x = Math.PI / 2;

            group.add(beam);
        }

        this.lightBeams = group;
        this.scene.add(this.lightBeams);
    }

    /**
     * Create central glow - bright core at destination
     */
    createCentralGlow() {
        const geometry = new THREE.SphereGeometry(3, 32, 32);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uProgress: { value: 0 },
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

                void main() {
                    // Rim-based glow
                    float rim = 1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0)));
                    rim = pow(rim, 2.0);
                    
                    // Color: white core, cyan edge
                    vec3 color = mix(vec3(1.0), vec3(0.3, 0.9, 1.0), rim);
                    
                    // Pulse
                    float pulse = 0.8 + sin(uTime * 5.0) * 0.2;
                    
                    float alpha = rim * pulse * uProgress * 2.0;
                    
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
     * Play the warp transition
     * @param {number} duration - Duration in ms
     * @returns {Promise} Resolves when animation completes
     */
    play(duration = 3000) {
        return new Promise((resolve) => {
            if (!this.scene) {
                this.init();
            }

            this.duration = duration;
            this.startTime = performance.now();
            this.isAnimating = true;
            this.onComplete = resolve;

            // Reset all uniforms
            this.resetUniforms();

            // Start with container visible but let animate() control opacity for smooth fade-in
            this.container.style.opacity = '0';
            this.container.style.transition = 'none'; // Disable CSS transition, we'll animate manually

            // Start animation loop
            this.animate();

            console.log(`[WarpTransition] Playing cinematic warp (${duration}ms)`);
        });
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
        if (this.lightBeams) {
            this.lightBeams.children.forEach((beam) => {
                beam.material.uniforms.uTime.value = 0;
                beam.material.uniforms.uProgress.value = 0;
            });
        }
        if (this.centralGlow) {
            this.centralGlow.material.uniforms.uTime.value = 0;
            this.centralGlow.material.uniforms.uProgress.value = 0;
        }
    }

    /**
     * Animation loop
     */
    animate() {
        if (!this.isAnimating) return;

        this.animationId = requestAnimationFrame(() => this.animate());

        const elapsed = performance.now() - this.startTime;
        const rawProgress = Math.min(elapsed / this.duration, 1);

        // Smooth easing curve
        const progress = this.easeInOutCubic(rawProgress);

        const time = elapsed / 1000;

        // Update all effects
        this.updateStarTrails(time, progress);
        this.updateEnergySpiral(time, progress);
        this.updateLightBeams(time, progress);
        this.updateCentralGlow(time, progress);
        this.updateCamera(progress);

        // Smooth opacity control: fade in (0-40%), hold (40-50%), fade out (50-100%)
        let opacity;
        if (rawProgress < 0.40) {
            // Very gradual fade in over first 40%
            const fadeInProgress = rawProgress / 0.40;
            opacity = fadeInProgress ** 2; // Quadratic ease-in for ultra smooth
        } else if (rawProgress < 0.50) {
            // Brief hold at full opacity
            opacity = 1;
        } else {
            // Gradual fade out over last 50%
            const fadeOutProgress = (rawProgress - 0.50) / 0.50;
            opacity = 1 - fadeOutProgress ** 1.5; // Smooth ease-out
        }
        this.container.style.opacity = String(opacity);

        this.renderer.render(this.scene, this.camera);

        // Animation complete
        if (rawProgress >= 1) {
            this.stop();
        }
    }

    easeInOutCubic(t) {
        return t < 0.5
            ? 4 * t * t * t
            : 1 - (-2 * t + 2) ** 3 / 2;
    }

    updateStarTrails(time, progress) {
        if (!this.starTrails) return;

        // Accelerate over time
        const speed = 1 + progress * 3;
        this.starTrails.material.uniforms.uTime.value = time * speed;
        this.starTrails.material.uniforms.uProgress.value = progress;
        this.starTrails.material.uniforms.uStretch.value = 1 + progress * 2;
    }

    updateEnergySpiral(time, progress) {
        if (!this.energySpiral) return;

        this.energySpiral.material.uniforms.uTime.value = time;
        this.energySpiral.material.uniforms.uProgress.value = Math.min(progress * 1.2, 1);
    }

    updateLightBeams(time, progress) {
        if (!this.lightBeams) return;

        this.lightBeams.rotation.z = time * 0.3;

        this.lightBeams.children.forEach((beam, i) => {
            beam.material.uniforms.uTime.value = time;
            beam.material.uniforms.uProgress.value = Math.min(progress * 1.5, 1);
        });
    }

    updateCentralGlow(time, progress) {
        if (!this.centralGlow) return;

        this.centralGlow.material.uniforms.uTime.value = time;
        this.centralGlow.material.uniforms.uProgress.value = progress;

        // Grow as we approach
        const scale = 5 + progress * 15;
        this.centralGlow.scale.setScalar(scale);

        // Move toward camera
        this.centralGlow.position.z = -50 + progress * 45;
    }

    updateCamera(progress) {
        // Subtle camera shake for intensity
        const shake = Math.sin(progress * Math.PI * 8) * (1 - progress) * 0.3;
        this.camera.position.x = shake;
        this.camera.position.y = shake * 0.5;

        // Move forward through tunnel
        this.camera.position.z = progress * 30;

        // Slight FOV increase for speed feeling
        this.camera.fov = 90 + progress * 20;
        this.camera.updateProjectionMatrix();
    }

    /**
     * Stop the animation
     */
    stop() {
        this.isAnimating = false;

        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }

        // Hide container
        this.container.style.opacity = '0';

        // Callback
        if (this.onComplete) {
            this.onComplete();
            this.onComplete = null;
        }

        console.log('[WarpTransition] Complete');
    }

    /**
     * Handle window resize
     */
    onResize() {
        if (!this.camera || !this.renderer) return;

        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    /**
     * Dispose and cleanup
     */
    dispose() {
        this.stop();

        window.removeEventListener('resize', this.resizeHandler);

        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }

        if (this.renderer) {
            this.renderer.dispose();
        }

        // Dispose geometries and materials
        [this.starTrails, this.energySpiral, this.centralGlow].forEach((obj) => {
            if (obj) {
                obj.geometry?.dispose();
                obj.material?.dispose();
            }
        });

        if (this.lightBeams) {
            this.lightBeams.children.forEach((beam) => {
                beam.geometry?.dispose();
                beam.material?.dispose();
            });
        }

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.container = null;

        console.log('[WarpTransition] Disposed');
    }
}

export default WarpTransitionRenderer;
