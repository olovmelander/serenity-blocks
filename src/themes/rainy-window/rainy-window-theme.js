import * as THREE from 'three';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { Water } from 'three/examples/jsm/objects/Water.js';

export default class RainyWindowTheme extends BaseTheme {
    constructor() {
        super('rainy-window');

        // Scene properties
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.water = null;
        this.sun = null;
        this.sky = null;
        this.clouds = null;

        // Effects
        this.rainSystem = null;
        this.lightningLight = null;
        this.lightningLight2 = null;
        this.ambientLight = null;
        this.lightningBolts = [];
        this.activeBolt = null;
        this.horizonHaze = null;

        // State
        this.time = 0;
        this.isRaining = true;
        this.lightningIntensity = 0;
        this.stormIntensity = 0.5; // 0 to 1
        this.targetStormIntensity = 0.5;
        this.nextLightningTime = 0;
        this.windStrength = 0.3;
        this.baseSkyColor = new THREE.Color(0x020203);
        this.lightningColor = new THREE.Color(0x8888ff);

        // Event handlers
        this.resizeHandler = this.resize.bind(this);
        this.eventUnsubscribers = [];
    }

    async createScene() {
        // Init Three.js
        this.initThreeJS();

        // Create Environment
        this.createEnvironment();

        // Create Clouds
        this.createClouds();

        // Create Horizon Haze
        this.createHorizonHaze();

        // Create Rain
        this.createRainSystem();

        // Create Lightning System
        this.createLightningSystem();

        // Setup Lighting
        this.setupLighting();

        // Start Loop
        this.animate();

        // Event Listeners
        this.setupEventListeners();

        // Schedule first random lightning
        this.scheduleNextLightning();

        console.log('⛈️ RainyWindow: Storm Scene Initialized');
    }

    initThreeJS() {
        this.container = document.body;

        // Setup Renderer
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.domElement.id = 'rainy-window-3d-canvas';
        this.renderer.domElement.style.position = 'fixed';
        this.renderer.domElement.style.top = '0';
        this.renderer.domElement.style.left = '0';
        this.renderer.domElement.style.width = '100%';
        this.renderer.domElement.style.height = '100%';
        this.renderer.domElement.style.zIndex = '-1';

        if (!document.getElementById('rainy-window-3d-canvas')) {
            this.container.appendChild(this.renderer.domElement);
        }

        // Setup Scene with darker fog
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x0a0a15, 0.0025);

        // Setup Camera
        this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, 20000);
        this.camera.position.set(30, 30, 100);
        this.camera.lookAt(0, 0, 0);

        window.addEventListener('resize', this.resizeHandler);
    }

    createEnvironment() {
        // Water - darker and stormier
        const waterGeometry = new THREE.PlaneGeometry(10000, 10000);

        // Load water normal texture
        const textureLoader = new THREE.TextureLoader();
        const waterNormalTexture = textureLoader.load(
            '/textures/water-normal.jpg',
            (texture) => {
                texture.wrapS = THREE.RepeatWrapping;
                texture.wrapT = THREE.RepeatWrapping;
                console.log('⛈️ RainyWindow: Water normal texture loaded');
            },
            undefined,
            (error) => {
                console.warn('⛈️ RainyWindow: Failed to load water texture, using fallback', error);
            }
        );

        this.water = new Water(
            waterGeometry,
            {
                textureWidth: 512,
                textureHeight: 512,
                waterNormals: waterNormalTexture,
                sunDirection: new THREE.Vector3(),
                sunColor: 0x555555,
                waterColor: 0x000205,
                distortionScale: 5.0,
                fog: this.scene.fog !== undefined
            }
        );

        this.water.rotation.x = -Math.PI / 2;
        this.water.position.y = -50;
        this.scene.add(this.water);

        // Dark stormy sky
        const skyGeo = new THREE.SphereGeometry(9000, 32, 15);
        const skyMat = new THREE.ShaderMaterial({
            uniforms: {
                topColor: { value: new THREE.Color(0x000005) },
                bottomColor: { value: new THREE.Color(0x0a0a20) },
                lightningFlash: { value: 0.0 },
                time: { value: 0 }
            },
            vertexShader: `
                varying vec3 vWorldPosition;
                void main() {
                    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPosition.xyz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 topColor;
                uniform vec3 bottomColor;
                uniform float lightningFlash;
                uniform float time;
                varying vec3 vWorldPosition;

                void main() {
                    float h = normalize(vWorldPosition).y;

                    // Base gradient
                    vec3 color = mix(bottomColor, topColor, max(h, 0.0));

                    // Add subtle cloud-like variation
                    float noise = sin(vWorldPosition.x * 0.001 + time * 0.1) *
                                  cos(vWorldPosition.z * 0.001 + time * 0.05) * 0.1;
                    color += vec3(noise * 0.02);

                    // Lightning flash
                    vec3 flashColor = vec3(0.4, 0.4, 0.6);
                    color = mix(color, flashColor, lightningFlash * 0.8);

                    gl_FragColor = vec4(color, 1.0);
                }
            `,
            side: THREE.BackSide
        });
        this.sky = new THREE.Mesh(skyGeo, skyMat);
        this.scene.add(this.sky);

        this.sun = new THREE.Vector3();
    }

    createClouds() {
        // Create volumetric cloud layer
        const cloudGeometry = new THREE.PlaneGeometry(8000, 8000, 1, 1);
        const cloudMaterial = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                lightningFlash: { value: 0.0 }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float time;
                uniform float lightningFlash;
                varying vec2 vUv;

                // Simplex noise function
                vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

                float snoise(vec2 v) {
                    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                                       -0.577350269189626, 0.024390243902439);
                    vec2 i  = floor(v + dot(v, C.yy));
                    vec2 x0 = v -   i + dot(i, C.xx);
                    vec2 i1;
                    i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
                    vec4 x12 = x0.xyxy + C.xxzz;
                    x12.xy -= i1;
                    i = mod289(i);
                    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
                        + i.x + vec3(0.0, i1.x, 1.0));
                    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
                        dot(x12.zw,x12.zw)), 0.0);
                    m = m*m; m = m*m;
                    vec3 x = 2.0 * fract(p * C.www) - 1.0;
                    vec3 h = abs(x) - 0.5;
                    vec3 ox = floor(x + 0.5);
                    vec3 a0 = x - ox;
                    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
                    vec3 g;
                    g.x  = a0.x  * x0.x  + h.x  * x0.y;
                    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
                    return 130.0 * dot(m, g);
                }

                float fbm(vec2 p) {
                    float f = 0.0;
                    f += 0.5000 * snoise(p); p *= 2.02;
                    f += 0.2500 * snoise(p); p *= 2.03;
                    f += 0.1250 * snoise(p); p *= 2.01;
                    f += 0.0625 * snoise(p);
                    return f / 0.9375;
                }

                void main() {
                    vec2 uv = vUv * 3.0;

                    // Moving clouds
                    float clouds = fbm(uv + vec2(time * 0.02, time * 0.01));
                    clouds = smoothstep(0.1, 0.6, clouds);

                    // Dark cloud color
                    vec3 cloudColor = vec3(0.02, 0.02, 0.04);

                    // Lightning illumination
                    vec3 litCloud = vec3(0.3, 0.3, 0.4);
                    cloudColor = mix(cloudColor, litCloud, lightningFlash);

                    float alpha = clouds * 0.7;
                    gl_FragColor = vec4(cloudColor, alpha);
                }
            `,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide
        });

        this.clouds = new THREE.Mesh(cloudGeometry, cloudMaterial);
        this.clouds.rotation.x = -Math.PI / 2;
        this.clouds.position.y = 400;
        this.scene.add(this.clouds);
    }

    createHorizonHaze() {
        // Create a large cylinder around the scene for horizon haze
        const hazeGeometry = new THREE.CylinderGeometry(5000, 5000, 600, 64, 1, true);
        const hazeMaterial = new THREE.ShaderMaterial({
            uniforms: {
                topColor: { value: new THREE.Color(0x0a0a15) },
                bottomColor: { value: new THREE.Color(0x0a0a15) },
                lightningFlash: { value: 0.0 }
            },
            vertexShader: `
                varying vec2 vUv;
                varying float vY;
                void main() {
                    vUv = uv;
                    vY = position.y;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 topColor;
                uniform vec3 bottomColor;
                uniform float lightningFlash;
                varying vec2 vUv;
                varying float vY;

                void main() {
                    // Normalized height (0 at bottom, 1 at top)
                    float h = (vY + 300.0) / 600.0;

                    // Create soft gradient - most opaque in middle, transparent at edges
                    float alpha = 1.0 - abs(h - 0.3) * 1.5;
                    alpha = clamp(alpha, 0.0, 1.0);
                    alpha = smoothstep(0.0, 1.0, alpha);

                    // Color gradient
                    vec3 color = mix(bottomColor, topColor, h);

                    // Lightning flash
                    vec3 flashColor = vec3(0.2, 0.2, 0.3);
                    color = mix(color, flashColor, lightningFlash * 0.5);

                    gl_FragColor = vec4(color, alpha * 0.85);
                }
            `,
            transparent: true,
            side: THREE.BackSide,
            depthWrite: false
        });

        this.horizonHaze = new THREE.Mesh(hazeGeometry, hazeMaterial);
        this.horizonHaze.position.y = -50; // Centered around water level
        this.scene.add(this.horizonHaze);
    }

    createRainSystem() {
        const particleCount = 50000;
        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const sizes = [];
        const randoms = [];

        for (let i = 0; i < particleCount; i++) {
            const x = Math.random() * 800 - 400;
            const y = Math.random() * 500 - 100;
            const z = Math.random() * 800 - 400;

            positions.push(x, y, z);
            sizes.push(0.3 + Math.random() * 0.7);
            randoms.push(Math.random());
        }

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
        geometry.setAttribute('random', new THREE.Float32BufferAttribute(randoms, 1));

        // Enhanced rain shader with wind
        const rainMaterial = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                color: { value: new THREE.Color(0x8899bb) },
                windStrength: { value: 0.3 },
                lightningFlash: { value: 0.0 }
            },
            vertexShader: `
                attribute float size;
                attribute float random;
                varying float vOpacity;
                varying float vFlash;
                uniform float time;
                uniform float windStrength;
                uniform float lightningFlash;

                void main() {
                    vec3 pos = position;

                    // Falling speed with variation
                    float speed = 10.0 + size * 5.0 + random * 3.0;
                    pos.y = mod(pos.y - time * speed * 50.0, 500.0) - 100.0;

                    // Wind effect - diagonal rain
                    float windOffset = time * windStrength * 100.0;
                    pos.x += windOffset + sin(time * 2.0 + position.z * 0.01) * 5.0 * windStrength;
                    pos.x = mod(pos.x + 400.0, 800.0) - 400.0;

                    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                    gl_Position = projectionMatrix * mvPosition;

                    // Size based on depth
                    gl_PointSize = size * (250.0 / -mvPosition.z);

                    // Fade based on distance
                    vOpacity = clamp(1.0 - (-mvPosition.z / 500.0), 0.2, 0.9) * size;
                    vFlash = lightningFlash;
                }
            `,
            fragmentShader: `
                uniform vec3 color;
                varying float vOpacity;
                varying float vFlash;

                void main() {
                    vec2 center = gl_PointCoord - vec2(0.5);
                    center.y *= 0.25; // More elongated
                    float dist = length(center);

                    if (dist > 0.5) discard;

                    float alpha = smoothstep(0.5, 0.0, dist) * vOpacity;

                    // Brighter during lightning
                    vec3 finalColor = mix(color, vec3(1.0), vFlash * 0.5);

                    gl_FragColor = vec4(finalColor, alpha);
                }
            `,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });

        this.rainSystem = new THREE.Points(geometry, rainMaterial);
        this.scene.add(this.rainSystem);
    }

    createLightningSystem() {
        // Pre-create some lightning bolt geometries
        for (let i = 0; i < 5; i++) {
            const bolt = this.generateLightningBolt();
            bolt.visible = false;
            this.scene.add(bolt);
            this.lightningBolts.push(bolt);
        }
    }

    generateLightningBolt() {
        const points = [];
        const segments = 15 + Math.floor(Math.random() * 10);

        // Start position - high in the sky
        let x = (Math.random() - 0.5) * 600;
        let y = 500;
        let z = (Math.random() - 0.5) * 600;

        points.push(new THREE.Vector3(x, y, z));

        // Generate jagged path
        for (let i = 1; i < segments; i++) {
            const t = i / segments;
            y = 500 - t * 600; // Go down
            x += (Math.random() - 0.5) * 80;
            z += (Math.random() - 0.5) * 40;

            points.push(new THREE.Vector3(x, y, z));

            // Chance for branch
            if (Math.random() < 0.2 && i > 3 && i < segments - 3) {
                const branchPoints = [];
                let bx = x, by = y, bz = z;
                const branchLen = 3 + Math.floor(Math.random() * 4);

                for (let j = 0; j < branchLen; j++) {
                    by -= 30 + Math.random() * 20;
                    bx += (Math.random() - 0.3) * 60;
                    bz += (Math.random() - 0.5) * 30;
                    branchPoints.push(new THREE.Vector3(bx, by, bz));
                }
            }
        }

        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({
            color: 0xaabbff,
            linewidth: 2,
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending
        });

        const bolt = new THREE.Line(geometry, material);

        // Add glow effect
        const glowMaterial = new THREE.LineBasicMaterial({
            color: 0x4444ff,
            linewidth: 4,
            transparent: true,
            opacity: 0.5,
            blending: THREE.AdditiveBlending
        });
        const glowBolt = new THREE.Line(geometry.clone(), glowMaterial);
        bolt.add(glowBolt);

        return bolt;
    }

    setupLighting() {
        // Dim ambient for stormy atmosphere
        this.ambientLight = new THREE.AmbientLight(0x111122, 0.3);
        this.scene.add(this.ambientLight);

        // Primary lightning light
        this.lightningLight = new THREE.PointLight(0x8888ff, 0, 15000);
        this.lightningLight.position.set(0, 500, 0);
        this.scene.add(this.lightningLight);

        // Secondary lightning light for more coverage
        this.lightningLight2 = new THREE.PointLight(0xaaaaff, 0, 10000);
        this.lightningLight2.position.set(-200, 400, -100);
        this.scene.add(this.lightningLight2);

        // Distant horizon light
        const horizonLight = new THREE.DirectionalLight(0x222233, 0.1);
        horizonLight.position.set(0, 100, -500);
        this.scene.add(horizonLight);
    }

    setupEventListeners() {
        this.eventUnsubscribers = [];

        // Line Clear -> Lightning
        this.eventUnsubscribers.push(eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            this.triggerLightning(data?.detail?.count || 1);
        }));

        // Combo -> Storm Intensity
        this.eventUnsubscribers.push(eventBus.on(EVENTS.COMBO, (data) => {
            this.intensifyStorm(data?.detail?.count || 1);
        }));
    }

    scheduleNextLightning() {
        // Random interval between 3-10 seconds
        const delay = 3 + Math.random() * 7;
        this.nextLightningTime = this.time + delay;
    }

    triggerLightning(intensity = 1) {
        this.lightningIntensity = 1.5 + (intensity * 0.5);

        // Show a random lightning bolt
        if (this.lightningBolts.length > 0) {
            // Hide previous bolt
            if (this.activeBolt) {
                this.activeBolt.visible = false;
            }

            // Regenerate and show a bolt
            const index = Math.floor(Math.random() * this.lightningBolts.length);
            const oldBolt = this.lightningBolts[index];
            oldBolt.geometry.dispose();

            // Create new bolt geometry
            const newBolt = this.generateLightningBolt();
            oldBolt.geometry = newBolt.geometry;
            oldBolt.position.copy(newBolt.position);
            oldBolt.visible = true;
            this.activeBolt = oldBolt;

            // Position secondary light near bolt
            this.lightningLight2.position.set(
                oldBolt.position.x + (Math.random() - 0.5) * 200,
                400,
                oldBolt.position.z + (Math.random() - 0.5) * 200
            );
        }

        // Boost storm temporarily
        this.targetStormIntensity = Math.min(1.0, this.stormIntensity + 0.2);
    }

    intensifyStorm(combo) {
        this.targetStormIntensity = Math.min(1.0, 0.5 + (combo * 0.15));
        this.windStrength = 0.3 + combo * 0.1;
    }

    animate() {
        if (!this.renderer) return;

        this.time += 1.0 / 60.0;

        // Random lightning
        if (this.time >= this.nextLightningTime) {
            this.triggerLightning(0.5 + Math.random() * 0.5);
            this.scheduleNextLightning();
        }

        // Smoothly return to base storm intensity
        this.targetStormIntensity = Math.max(0.5, this.targetStormIntensity - 0.003);
        this.stormIntensity += (this.targetStormIntensity - this.stormIntensity) * 0.05;
        this.windStrength = Math.max(0.3, this.windStrength - 0.001);

        // Animate Water
        if (this.water) {
            this.water.material.uniforms['time'].value += 1.0 / 60.0;
            this.water.material.uniforms['distortionScale'].value = 5.0 + (this.stormIntensity * 3.0);
        }

        // Animate Clouds
        if (this.clouds && this.clouds.material.uniforms) {
            this.clouds.material.uniforms.time.value = this.time;
            this.clouds.material.uniforms.lightningFlash.value = this.lightningIntensity;
        }

        // Animate Sky
        if (this.sky && this.sky.material.uniforms) {
            this.sky.material.uniforms.time.value = this.time;
            this.sky.material.uniforms.lightningFlash.value = this.lightningIntensity * 0.7;
        }

        // Animate Horizon Haze
        if (this.horizonHaze && this.horizonHaze.material.uniforms) {
            this.horizonHaze.material.uniforms.lightningFlash.value = this.lightningIntensity * 0.6;
        }

        // Animate Rain
        if (this.rainSystem && this.rainSystem.material.uniforms) {
            this.rainSystem.material.uniforms.time.value = this.time * (0.5 + this.stormIntensity * 0.5);
            this.rainSystem.material.uniforms.windStrength.value = this.windStrength;
            this.rainSystem.material.uniforms.lightningFlash.value = this.lightningIntensity;
        }

        // Lightning Decay
        if (this.lightningIntensity > 0) {
            this.lightningIntensity *= 0.85;

            // Main light with flicker
            let intensity1 = this.lightningIntensity * 3;
            let intensity2 = this.lightningIntensity * 2;

            // Random flicker
            if (Math.random() < 0.4) {
                intensity1 *= 0.3 + Math.random() * 0.7;
                intensity2 *= 0.3 + Math.random() * 0.7;
            }

            this.lightningLight.intensity = intensity1;
            this.lightningLight2.intensity = intensity2;

            // Flash ambient
            this.ambientLight.intensity = 0.3 + this.lightningIntensity * 0.5;

            // Fog flash
            this.scene.fog.density = 0.0025 - (this.lightningIntensity * 0.001);

            // Fade bolt opacity
            if (this.activeBolt) {
                this.activeBolt.material.opacity = this.lightningIntensity;
                if (this.activeBolt.children[0]) {
                    this.activeBolt.children[0].material.opacity = this.lightningIntensity * 0.5;
                }
            }
        } else {
            this.lightningLight.intensity = 0;
            this.lightningLight2.intensity = 0;
            this.ambientLight.intensity = 0.3;
            this.scene.fog.density = 0.0025;

            // Hide bolt
            if (this.activeBolt) {
                this.activeBolt.visible = false;
            }
        }

        // Render
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }

        requestAnimationFrame(() => this.animate());
    }

    resize() {
        if (!this.renderer || !this.camera) return;

        const width = window.innerWidth;
        const height = window.innerHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    cleanup() {
        if (this.renderer) {
            this.renderer.dispose();
            if (this.renderer.domElement && this.renderer.domElement.parentNode) {
                this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
            }
        }

        // Dispose rain system
        if (this.rainSystem) {
            this.rainSystem.geometry.dispose();
            this.rainSystem.material.dispose();
        }

        // Dispose lightning bolts
        this.lightningBolts.forEach(bolt => {
            bolt.geometry.dispose();
            bolt.material.dispose();
        });

        // Dispose clouds
        if (this.clouds) {
            this.clouds.geometry.dispose();
            this.clouds.material.dispose();
        }

        // Dispose horizon haze
        if (this.horizonHaze) {
            this.horizonHaze.geometry.dispose();
            this.horizonHaze.material.dispose();
        }

        window.removeEventListener('resize', this.resizeHandler);
        this.eventUnsubscribers.forEach(u => u());
    }

    // Required by BaseTheme
    getStyles() {
        return {
            '--bg-color': '#050608',
            '--grid-color': 'rgba(255, 255, 255, 0.05)',
            ...super.getStyles()
        };
    }
}
