/**
 * Three.js Breathing Renderer - Immersive 3D breathing visualizations
 * 
 * Replaces 2D WebGL shaders with stunning 3D scenes for each breathing technique.
 * Uses Three.js with post-processing for cinematic quality.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// Quality Presets
const QUALITY_PRESETS = {
    Extreme: { particleCount: 5000, enableBloom: true, bloomStrength: 0.7, geometryDetail: 64 },
    High: { particleCount: 3000, enableBloom: true, bloomStrength: 0.5, geometryDetail: 48 },
    Medium: { particleCount: 1500, enableBloom: true, bloomStrength: 0.4, geometryDetail: 32 },
    Low: { particleCount: 800, enableBloom: false, bloomStrength: 0, geometryDetail: 24 },
    Minimal: { particleCount: 400, enableBloom: false, bloomStrength: 0, geometryDetail: 16 },
};

export class ThreeJSBreathingRenderer {
    constructor(container) {
        this.container = container;
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.composer = null;
        this.clock = new THREE.Clock();

        this.isRunning = false;
        this.animationId = null;

        this.intensity = 0.5;
        this.phase = 'inhale';
        this.currentTechnique = 'deep-relaxation';
        this.techniqueParams = {};

        this.quality = QUALITY_PRESETS.High;
        this.sceneObjects = {};
    }

    init() {
        if (this.renderer) return;

        const width = this.container.offsetWidth || 700;
        const height = this.container.offsetHeight || 700;

        // Renderer with proper transparency
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            premultipliedAlpha: false,
        });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(0x000000, 0); // Fully transparent
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.4;
        this.renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;border-radius:50%;';
        this.container.appendChild(this.renderer.domElement);

        // Scene - no background, fully transparent
        this.scene = new THREE.Scene();
        this.scene.background = null; // Explicit null for transparency

        // Camera
        this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
        this.camera.position.z = 5;

        // Post-processing - skip for now to maintain transparency
        // Bloom causes alpha issues, so we'll use additive blending on materials instead
        this.usePostProcessing = false;
        if (this.usePostProcessing && this.quality.enableBloom) {
            this.setupPostProcessing(width, height);
        }

        console.log('[ThreeJSBreathingRenderer] Initialized with transparent background');
    }

    setupPostProcessing(width, height) {
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        if (this.quality.enableBloom) {
            const bloomPass = new UnrealBloomPass(
                new THREE.Vector2(width, height),
                this.quality.bloomStrength,
                0.4,
                0.85
            );
            this.composer.addPass(bloomPass);
            this.bloomPass = bloomPass;
        }
    }

    setTechnique(techniqueName, params) {
        this.currentTechnique = techniqueName;
        this.techniqueParams = params;
        this.rebuildScene();
    }

    updateIntensity(intensity, phase) {
        this.intensity = intensity;
        this.phase = phase;
    }

    rebuildScene() {
        // Clear existing scene objects
        this.clearScene();

        // Build technique-specific scene
        switch (this.currentTechnique) {
            case 'deep-relaxation': this.createAuroraScene(); break;
            case 'ocean-breath': this.createOceanScene(); break;
            case 'wim-hof': this.createVolcanicScene(); break;
            case 'cosmic-breath': this.createNebulaScene(); break;
            case 'forest-breath': this.createForestScene(); break;
            case 'electric-storm': this.createStormScene(); break;
            case 'energizing': this.createSolarScene(); break;
            case 'coherence': this.createHeartScene(); break;
            case 'calm-sleep': this.createMoonlitScene(); break;
            case 'box-breathing': this.createSacredGeometryScene(); break;
            case 'triangle': this.createCrystalScene(); break;
            case 'zen-garden': this.createZenGardenScene(); break;
            default: this.createAuroraScene(); break;
        }

        console.log(`[ThreeJSBreathingRenderer] Scene built: ${this.currentTechnique}`);
    }

    clearScene() {
        // Clear fog from previous scene
        this.scene.fog = null;
        this.scene.background = null;

        while (this.scene.children.length > 0) {
            const obj = this.scene.children[0];
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(m => m.dispose());
                } else {
                    obj.material.dispose();
                }
            }
            this.scene.remove(obj);
        }
        this.sceneObjects = {};
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.clock.start();
        this.rebuildScene();
        this.animate();
    }

    stop() {
        this.isRunning = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    animate() {
        if (!this.isRunning) return;
        this.animationId = requestAnimationFrame(() => this.animate());

        const time = this.clock.getElapsedTime();
        const delta = this.clock.getDelta();

        this.updateScene(time, delta);

        // Render directly without composer for proper transparency
        this.renderer.render(this.scene, this.camera);
    }

    updateScene(time, delta) {
        const breathScale = 0.8 + this.intensity * 0.4;

        // Update technique-specific animations
        switch (this.currentTechnique) {
            case 'deep-relaxation': this.updateAurora(time, breathScale); break;
            case 'ocean-breath': this.updateOcean(time, breathScale); break;
            case 'wim-hof': this.updateVolcanic(time, breathScale); break;
            case 'cosmic-breath': this.updateNebula(time, breathScale); break;
            case 'forest-breath': this.updateForest(time, breathScale); break;
            case 'electric-storm': this.updateStorm(time, breathScale); break;
            case 'energizing': this.updateSolar(time, breathScale); break;
            case 'coherence': this.updateHeart(time, breathScale); break;
            case 'calm-sleep': this.updateMoonlit(time, breathScale); break;
            case 'box-breathing': this.updateSacredGeometry(time, breathScale); break;
            case 'triangle': this.updateCrystal(time, breathScale); break;
            case 'zen-garden': this.updateZenGarden(time, breathScale); break;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // AURORA DREAMS - Northern lights with stars and mountains
    // ═══════════════════════════════════════════════════════════════════════════

    createAuroraScene() {
        const c = this.techniqueParams.color || { r: 80, g: 200, b: 255 };
        const c2 = this.techniqueParams.secondaryColor || { r: 180, g: 100, b: 255 };

        // Starfield
        const starGeom = new THREE.BufferGeometry();
        const starCount = this.quality.particleCount;
        const starPos = new Float32Array(starCount * 3);
        for (let i = 0; i < starCount; i++) {
            starPos[i * 3] = (Math.random() - 0.5) * 20;
            starPos[i * 3 + 1] = (Math.random() - 0.5) * 20;
            starPos[i * 3 + 2] = (Math.random() - 0.5) * 10 - 5;
        }
        starGeom.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
        const starMat = new THREE.PointsMaterial({
            color: 0xffffff,
            size: 0.03,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
        });
        this.sceneObjects.stars = new THREE.Points(starGeom, starMat);
        this.scene.add(this.sceneObjects.stars);

        // Aurora curtains (multiple ribbon planes)
        const curtainCount = 3;
        this.sceneObjects.curtains = [];
        for (let i = 0; i < curtainCount; i++) {
            const curtainGeom = new THREE.PlaneGeometry(8, 4, 64, 32);
            const curtainMat = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uColor1: { value: new THREE.Color(c.r / 255, c.g / 255, c.b / 255) },
                    uColor2: { value: new THREE.Color(c2.r / 255, c2.g / 255, c2.b / 255) },
                    uIntensity: { value: 0.5 },
                    uLayer: { value: i },
                },
                vertexShader: `
                    uniform float uTime;
                    uniform float uLayer;
                    varying vec2 vUv;
                    varying float vWave;
                    void main() {
                        vUv = uv;
                        vec3 pos = position;
                        float wave = sin(pos.x * 2.0 + uTime * 0.5 + uLayer) * 0.3;
                        wave += sin(pos.x * 4.0 - uTime * 0.3) * 0.15;
                        pos.z += wave;
                        pos.y += sin(pos.x * 3.0 + uTime * 0.2) * 0.2;
                        vWave = wave;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform vec3 uColor1;
                    uniform vec3 uColor2;
                    uniform float uIntensity;
                    uniform float uTime;
                    varying vec2 vUv;
                    varying float vWave;
                    void main() {
                        float gradient = vUv.y;
                        vec3 color = mix(uColor1, uColor2, gradient + vWave * 0.5);
                        float shimmer = sin(vUv.y * 20.0 + uTime * 3.0) * 0.1 + 0.9;
                        float alpha = gradient * shimmer * uIntensity * 0.6;
                        alpha *= smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.7, vUv.y);
                        gl_FragColor = vec4(color * 1.5, alpha);
                    }
                `,
                transparent: true,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });
            const curtain = new THREE.Mesh(curtainGeom, curtainMat);
            curtain.position.set(0, 1 - i * 0.3, -2 - i * 0.5);
            curtain.rotation.x = -0.2;
            this.sceneObjects.curtains.push(curtain);
            this.scene.add(curtain);
        }

        // Mountain silhouette
        const mountainShape = new THREE.Shape();
        mountainShape.moveTo(-6, -2);
        mountainShape.lineTo(-4, 0);
        mountainShape.lineTo(-2.5, -0.5);
        mountainShape.lineTo(-1, 1);
        mountainShape.lineTo(0.5, 0);
        mountainShape.lineTo(2, 0.8);
        mountainShape.lineTo(4, -0.3);
        mountainShape.lineTo(6, -2);
        mountainShape.lineTo(-6, -2);
        const mountainGeom = new THREE.ShapeGeometry(mountainShape);
        const mountainMat = new THREE.MeshBasicMaterial({ color: 0x0a0a12, side: THREE.DoubleSide });
        this.sceneObjects.mountains = new THREE.Mesh(mountainGeom, mountainMat);
        this.sceneObjects.mountains.position.set(0, -1.5, 0);
        this.scene.add(this.sceneObjects.mountains);
    }

    updateAurora(time, breathScale) {
        if (this.sceneObjects.curtains) {
            this.sceneObjects.curtains.forEach((curtain, i) => {
                curtain.material.uniforms.uTime.value = time;
                curtain.material.uniforms.uIntensity.value = this.intensity;
                curtain.scale.set(breathScale, breathScale, 1);
            });
        }
        if (this.sceneObjects.stars) {
            this.sceneObjects.stars.rotation.z = time * 0.01;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // OCEAN TIDE - Underwater scene with caustics
    // ═══════════════════════════════════════════════════════════════════════════

    createOceanScene() {
        const c = this.techniqueParams.color || { r: 30, g: 150, b: 200 };

        // Underwater fog
        this.scene.fog = new THREE.FogExp2(new THREE.Color(c.r / 255 * 0.2, c.g / 255 * 0.2, c.b / 255 * 0.2), 0.15);

        // Water surface plane with caustics shader
        const waterGeom = new THREE.PlaneGeometry(10, 10, 64, 64);
        const waterMat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uColor: { value: new THREE.Color(c.r / 255, c.g / 255, c.b / 255) },
                uIntensity: { value: 0.5 },
            },
            vertexShader: `
                uniform float uTime;
                varying vec2 vUv;
                varying float vElevation;
                void main() {
                    vUv = uv;
                    vec3 pos = position;
                    float wave1 = sin(pos.x * 3.0 + uTime * 2.0) * 0.1;
                    float wave2 = sin(pos.y * 4.0 - uTime * 1.5) * 0.08;
                    pos.z = wave1 + wave2;
                    vElevation = pos.z;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 uColor;
                uniform float uTime;
                uniform float uIntensity;
                varying vec2 vUv;
                varying float vElevation;
                void main() {
                    vec2 uv = vUv * 10.0;
                    float caustic1 = sin(uv.x * 2.0 + uTime * 2.0) * sin(uv.y * 2.0 - uTime * 1.5);
                    float caustic2 = sin(uv.x * 3.0 - uTime * 1.8) * sin(uv.y * 3.0 + uTime * 2.2);
                    float caustics = (caustic1 + caustic2) * 0.25 + 0.5;
                    caustics = pow(caustics, 2.0);
                    vec3 color = uColor + vec3(0.2, 0.3, 0.4) * caustics * uIntensity;
                    float alpha = 0.6 + vElevation * 2.0;
                    gl_FragColor = vec4(color, alpha * uIntensity);
                }
            `,
            transparent: true,
            side: THREE.DoubleSide,
        });
        this.sceneObjects.water = new THREE.Mesh(waterGeom, waterMat);
        this.sceneObjects.water.rotation.x = -Math.PI * 0.4;
        this.sceneObjects.water.position.y = 2;
        this.scene.add(this.sceneObjects.water);

        // Bubbles
        const bubbleCount = Math.floor(this.quality.particleCount * 0.3);
        const bubbleGeom = new THREE.BufferGeometry();
        const bubblePos = new Float32Array(bubbleCount * 3);
        const bubbleSizes = new Float32Array(bubbleCount);
        for (let i = 0; i < bubbleCount; i++) {
            bubblePos[i * 3] = (Math.random() - 0.5) * 6;
            bubblePos[i * 3 + 1] = Math.random() * 6 - 3;
            bubblePos[i * 3 + 2] = (Math.random() - 0.5) * 4;
            bubbleSizes[i] = Math.random() * 0.1 + 0.02;
        }
        bubbleGeom.setAttribute('position', new THREE.BufferAttribute(bubblePos, 3));
        bubbleGeom.setAttribute('size', new THREE.BufferAttribute(bubbleSizes, 1));
        const bubbleMat = new THREE.PointsMaterial({
            color: 0x88ccff,
            size: 0.08,
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending,
        });
        this.sceneObjects.bubbles = new THREE.Points(bubbleGeom, bubbleMat);
        this.scene.add(this.sceneObjects.bubbles);

        // Light rays
        const rayGeom = new THREE.ConeGeometry(0.5, 8, 4, 1, true);
        const rayMat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(c.r / 255, c.g / 255, c.b / 255).multiplyScalar(1.5),
            transparent: true,
            opacity: 0.15,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        });
        this.sceneObjects.rays = [];
        for (let i = 0; i < 5; i++) {
            const ray = new THREE.Mesh(rayGeom, rayMat.clone());
            ray.position.set(-2 + i * 1, 4, -2);
            ray.rotation.x = Math.PI;
            this.sceneObjects.rays.push(ray);
            this.scene.add(ray);
        }
    }

    updateOcean(time, breathScale) {
        if (this.sceneObjects.water) {
            this.sceneObjects.water.material.uniforms.uTime.value = time;
            this.sceneObjects.water.material.uniforms.uIntensity.value = this.intensity;
        }
        if (this.sceneObjects.bubbles) {
            const pos = this.sceneObjects.bubbles.geometry.attributes.position.array;
            for (let i = 0; i < pos.length / 3; i++) {
                pos[i * 3 + 1] += 0.02;
                if (pos[i * 3 + 1] > 4) pos[i * 3 + 1] = -3;
            }
            this.sceneObjects.bubbles.geometry.attributes.position.needsUpdate = true;
            this.sceneObjects.bubbles.material.opacity = 0.4 + this.intensity * 0.4;
        }
        if (this.sceneObjects.rays) {
            this.sceneObjects.rays.forEach((ray, i) => {
                ray.material.opacity = 0.1 + Math.sin(time + i) * 0.05 * this.intensity;
            });
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // VOLCANIC FIRE - Lava and embers
    // ═══════════════════════════════════════════════════════════════════════════

    createVolcanicScene() {
        const c = this.techniqueParams.color || { r: 255, g: 80, b: 30 };

        // Lava plane
        const lavaGeom = new THREE.PlaneGeometry(8, 8, 64, 64);
        const lavaMat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uIntensity: { value: 0.5 },
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
                uniform float uIntensity;
                varying vec2 vUv;
                
                float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
                float noise(vec2 p) {
                    vec2 i = floor(p);
                    vec2 f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);
                    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
                }
                float fbm(vec2 p) {
                    float v = 0.0;
                    v += noise(p) * 0.5;
                    v += noise(p * 2.0) * 0.25;
                    v += noise(p * 4.0) * 0.125;
                    return v;
                }
                
                void main() {
                    vec2 uv = vUv * 3.0;
                    float lava = fbm(uv + vec2(0.0, -uTime * 0.2));
                    float cracks = 1.0 - abs(noise(uv * 5.0 + uTime * 0.1) - 0.5) * 2.0;
                    cracks = pow(cracks, 8.0);
                    
                    vec3 darkRed = vec3(0.4, 0.08, 0.0);
                    vec3 orange = vec3(1.0, 0.5, 0.1);
                    vec3 yellow = vec3(1.0, 0.95, 0.5);
                    
                    vec3 color = mix(darkRed, orange, lava);
                    color = mix(color, yellow, cracks * uIntensity);
                    color += vec3(0.6, 0.25, 0.0) * uIntensity * 0.5;
                    
                    // Radial fade for smooth blending with circular container
                    float dist = length(vUv - 0.5) * 2.0;
                    float radialFade = 1.0 - smoothstep(0.6, 1.0, dist);
                    
                    float heat = 1.0 - smoothstep(0.0, 0.5, dist * 0.5);
                    color += vec3(0.4, 0.15, 0.0) * heat * uIntensity;
                    
                    // Make brighter for more premium look
                    color *= 1.2;
                    
                    gl_FragColor = vec4(color, radialFade * 0.85);
                }
            `,
            transparent: true,
        });
        this.sceneObjects.lava = new THREE.Mesh(lavaGeom, lavaMat);
        this.sceneObjects.lava.rotation.x = -Math.PI * 0.5;
        this.sceneObjects.lava.position.y = -1;
        this.scene.add(this.sceneObjects.lava);

        // Embers
        const emberCount = this.quality.particleCount;
        const emberGeom = new THREE.BufferGeometry();
        const emberPos = new Float32Array(emberCount * 3);
        const emberVel = new Float32Array(emberCount);
        for (let i = 0; i < emberCount; i++) {
            emberPos[i * 3] = (Math.random() - 0.5) * 6;
            emberPos[i * 3 + 1] = Math.random() * 8 - 2;
            emberPos[i * 3 + 2] = (Math.random() - 0.5) * 4;
            emberVel[i] = 0.02 + Math.random() * 0.04;
        }
        emberGeom.setAttribute('position', new THREE.BufferAttribute(emberPos, 3));
        this.emberVelocities = emberVel;
        const emberMat = new THREE.PointsMaterial({
            color: new THREE.Color(c.r / 255, c.g / 255, c.b / 255),
            size: 0.06,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
        });
        this.sceneObjects.embers = new THREE.Points(emberGeom, emberMat);
        this.scene.add(this.sceneObjects.embers);

        // Core glow
        const glowGeom = new THREE.SphereGeometry(1.5, 32, 32);
        const glowMat = new THREE.MeshBasicMaterial({
            color: 0xff6600,
            transparent: true,
            opacity: 0.3,
            blending: THREE.AdditiveBlending,
        });
        this.sceneObjects.coreGlow = new THREE.Mesh(glowGeom, glowMat);
        this.sceneObjects.coreGlow.position.y = -0.5;
        this.scene.add(this.sceneObjects.coreGlow);
    }

    updateVolcanic(time, breathScale) {
        if (this.sceneObjects.lava) {
            this.sceneObjects.lava.material.uniforms.uTime.value = time;
            this.sceneObjects.lava.material.uniforms.uIntensity.value = this.intensity;
        }
        if (this.sceneObjects.embers && this.emberVelocities) {
            const pos = this.sceneObjects.embers.geometry.attributes.position.array;
            for (let i = 0; i < this.emberVelocities.length; i++) {
                pos[i * 3 + 1] += this.emberVelocities[i] * (0.5 + this.intensity);
                pos[i * 3] += Math.sin(time * 2 + i) * 0.01;
                if (pos[i * 3 + 1] > 6) {
                    pos[i * 3 + 1] = -2;
                    pos[i * 3] = (Math.random() - 0.5) * 6;
                }
            }
            this.sceneObjects.embers.geometry.attributes.position.needsUpdate = true;
        }
        if (this.sceneObjects.coreGlow) {
            this.sceneObjects.coreGlow.scale.setScalar(breathScale * 1.2);
            this.sceneObjects.coreGlow.material.opacity = 0.2 + this.intensity * 0.3;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // COSMIC NEBULA - Spiral galaxy
    // ═══════════════════════════════════════════════════════════════════════════

    createNebulaScene() {
        const c = this.techniqueParams.color || { r: 150, g: 50, b: 200 };
        const c2 = this.techniqueParams.secondaryColor || { r: 255, g: 100, b: 150 };

        // Spiral galaxy particles
        const galaxyCount = this.quality.particleCount;
        const galaxyGeom = new THREE.BufferGeometry();
        const galaxyPos = new Float32Array(galaxyCount * 3);
        const galaxyColors = new Float32Array(galaxyCount * 3);

        for (let i = 0; i < galaxyCount; i++) {
            const angle = (i / galaxyCount) * Math.PI * 6;
            const radius = 0.2 + (i / galaxyCount) * 3;
            const armOffset = (i % 2 === 0 ? 0 : Math.PI);

            galaxyPos[i * 3] = Math.cos(angle + armOffset) * radius + (Math.random() - 0.5) * 0.5;
            galaxyPos[i * 3 + 1] = (Math.random() - 0.5) * 0.3;
            galaxyPos[i * 3 + 2] = Math.sin(angle + armOffset) * radius + (Math.random() - 0.5) * 0.5;

            const colorMix = i / galaxyCount;
            galaxyColors[i * 3] = (c.r / 255) * (1 - colorMix) + (c2.r / 255) * colorMix;
            galaxyColors[i * 3 + 1] = (c.g / 255) * (1 - colorMix) + (c2.g / 255) * colorMix;
            galaxyColors[i * 3 + 2] = (c.b / 255) * (1 - colorMix) + (c2.b / 255) * colorMix;
        }
        galaxyGeom.setAttribute('position', new THREE.BufferAttribute(galaxyPos, 3));
        galaxyGeom.setAttribute('color', new THREE.BufferAttribute(galaxyColors, 3));

        const galaxyMat = new THREE.PointsMaterial({
            size: 0.04,
            vertexColors: true,
            transparent: true,
            opacity: 0.5, // Reduced for better text visibility
            blending: THREE.AdditiveBlending,
        });
        this.sceneObjects.galaxy = new THREE.Points(galaxyGeom, galaxyMat);
        this.scene.add(this.sceneObjects.galaxy);

        // Core glow
        const coreGeom = new THREE.SphereGeometry(0.3, 32, 32);
        const coreMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.5, // Reduced for better text visibility
        });
        this.sceneObjects.nebulaCore = new THREE.Mesh(coreGeom, coreMat);
        this.scene.add(this.sceneObjects.nebulaCore);

        // Background stars
        const starCount = Math.floor(this.quality.particleCount * 0.5);
        const starGeom = new THREE.BufferGeometry();
        const starPos = new Float32Array(starCount * 3);
        for (let i = 0; i < starCount; i++) {
            starPos[i * 3] = (Math.random() - 0.5) * 20;
            starPos[i * 3 + 1] = (Math.random() - 0.5) * 20;
            starPos[i * 3 + 2] = -10 + Math.random() * 5;
        }
        starGeom.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
        const starMat = new THREE.PointsMaterial({
            color: 0xffffff,
            size: 0.02,
            transparent: true,
            opacity: 0.6,
        });
        this.sceneObjects.bgStars = new THREE.Points(starGeom, starMat);
        this.scene.add(this.sceneObjects.bgStars);
    }

    updateNebula(time, breathScale) {
        if (this.sceneObjects.galaxy) {
            this.sceneObjects.galaxy.rotation.y = time * 0.1;
            this.sceneObjects.galaxy.scale.setScalar(breathScale);
        }
        if (this.sceneObjects.nebulaCore) {
            this.sceneObjects.nebulaCore.scale.setScalar(0.3 + Math.sin(time * 2) * 0.1 * this.intensity);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ANCIENT FOREST - God rays and fireflies
    // ═══════════════════════════════════════════════════════════════════════════

    createForestScene() {
        const c = this.techniqueParams.color || { r: 50, g: 180, b: 100 };
        const c2 = this.techniqueParams.secondaryColor || { r: 150, g: 100, b: 50 };

        // Fog for depth
        this.scene.fog = new THREE.FogExp2(0x0a1510, 0.08);

        // Tree silhouettes (simple cones)
        this.sceneObjects.trees = [];
        for (let i = 0; i < 8; i++) {
            const treeGroup = new THREE.Group();
            const trunkGeom = new THREE.CylinderGeometry(0.05, 0.08, 1.5, 8);
            const trunkMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(c2.r / 255, c2.g / 255, c2.b / 255) });
            const trunk = new THREE.Mesh(trunkGeom, trunkMat);
            trunk.position.y = -1;

            const foliageGeom = new THREE.ConeGeometry(0.6, 2, 8);
            const foliageMat = new THREE.MeshBasicMaterial({
                color: new THREE.Color(c.r / 255 * 0.3, c.g / 255 * 0.3, c.b / 255 * 0.3),
                transparent: true,
                opacity: 0.8
            });
            const foliage = new THREE.Mesh(foliageGeom, foliageMat);
            foliage.position.y = 0.5;

            treeGroup.add(trunk);
            treeGroup.add(foliage);
            treeGroup.position.set((i - 4) * 1.2 + Math.random() * 0.5, 0, -2 - Math.random() * 2);
            treeGroup.scale.setScalar(0.8 + Math.random() * 0.4);
            this.sceneObjects.trees.push(treeGroup);
            this.scene.add(treeGroup);
        }

        // God rays
        const rayGeom = new THREE.PlaneGeometry(0.3, 6);
        const rayMat = new THREE.MeshBasicMaterial({
            color: 0xc8e8a0,
            transparent: true,
            opacity: 0.15,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        });
        this.sceneObjects.godRays = [];
        for (let i = 0; i < 7; i++) {
            const ray = new THREE.Mesh(rayGeom, rayMat.clone());
            ray.position.set(-3 + i * 1, 2, -1);
            ray.rotation.z = -0.2 + i * 0.05;
            this.sceneObjects.godRays.push(ray);
            this.scene.add(ray);
        }

        // Fireflies
        const fireflyCount = Math.floor(this.quality.particleCount * 0.2);
        const fireflyGeom = new THREE.BufferGeometry();
        const fireflyPos = new Float32Array(fireflyCount * 3);
        const fireflyPhase = new Float32Array(fireflyCount);
        for (let i = 0; i < fireflyCount; i++) {
            fireflyPos[i * 3] = (Math.random() - 0.5) * 8;
            fireflyPos[i * 3 + 1] = Math.random() * 3 - 1;
            fireflyPos[i * 3 + 2] = (Math.random() - 0.5) * 4;
            fireflyPhase[i] = Math.random() * Math.PI * 2;
        }
        fireflyGeom.setAttribute('position', new THREE.BufferAttribute(fireflyPos, 3));
        this.fireflyPhases = fireflyPhase;
        const fireflyMat = new THREE.PointsMaterial({
            color: 0xccff66,
            size: 0.08,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
        });
        this.sceneObjects.fireflies = new THREE.Points(fireflyGeom, fireflyMat);
        this.scene.add(this.sceneObjects.fireflies);
    }

    updateForest(time, breathScale) {
        if (this.sceneObjects.godRays) {
            this.sceneObjects.godRays.forEach((ray, i) => {
                ray.material.opacity = 0.1 + Math.sin(time * 0.5 + i) * 0.05 * this.intensity;
                ray.scale.x = breathScale;
            });
        }
        if (this.sceneObjects.fireflies && this.fireflyPhases) {
            const pos = this.sceneObjects.fireflies.geometry.attributes.position.array;
            for (let i = 0; i < this.fireflyPhases.length; i++) {
                pos[i * 3] += Math.sin(time * 0.8 + this.fireflyPhases[i]) * 0.01;
                pos[i * 3 + 1] += Math.cos(time * 0.6 + this.fireflyPhases[i] * 1.3) * 0.005;
            }
            this.sceneObjects.fireflies.geometry.attributes.position.needsUpdate = true;
            // Pulsing glow
            this.sceneObjects.fireflies.material.opacity = 0.3 + Math.pow(Math.sin(time * 3) * 0.5 + 0.5, 2) * 0.7 * this.intensity;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ELECTRIC STORM - Lightning and clouds
    // ═══════════════════════════════════════════════════════════════════════════

    createStormScene() {
        const c = this.techniqueParams.color || { r: 100, g: 150, b: 255 };

        // Dark sky
        // Dark fog instead of solid background (maintains transparency)
        this.scene.fog = new THREE.FogExp2(0x0a0a15, 0.05);

        // Storm clouds
        const cloudCount = 8;
        this.sceneObjects.clouds = [];
        for (let i = 0; i < cloudCount; i++) {
            const cloudGeom = new THREE.SphereGeometry(1 + Math.random(), 16, 16);
            const cloudMat = new THREE.MeshBasicMaterial({
                color: 0x222233,
                transparent: true,
                opacity: 0.6,
            });
            const cloud = new THREE.Mesh(cloudGeom, cloudMat);
            cloud.position.set((Math.random() - 0.5) * 8, 2 + Math.random(), -3 - Math.random() * 2);
            cloud.scale.set(1.5, 0.5, 1);
            this.sceneObjects.clouds.push(cloud);
            this.scene.add(cloud);
        }

        // Lightning bolt geometry (line)
        this.sceneObjects.lightnings = [];
        for (let b = 0; b < 3; b++) {
            const points = [];
            let y = 3;
            let x = (b - 1) * 2;
            for (let i = 0; i < 8; i++) {
                points.push(new THREE.Vector3(x, y, -2));
                y -= 0.5;
                x += (Math.random() - 0.5) * 0.8;
            }
            const lightningGeom = new THREE.BufferGeometry().setFromPoints(points);
            const lightningMat = new THREE.LineBasicMaterial({
                color: new THREE.Color(c.r / 255, c.g / 255, c.b / 255),
                transparent: true,
                opacity: 0,
                linewidth: 2,
            });
            const lightning = new THREE.Line(lightningGeom, lightningMat);
            lightning.userData.nextFlash = Math.random() * 4;
            this.sceneObjects.lightnings.push(lightning);
            this.scene.add(lightning);
        }

        // Rain particles
        const rainCount = this.quality.particleCount;
        const rainGeom = new THREE.BufferGeometry();
        const rainPos = new Float32Array(rainCount * 3);
        for (let i = 0; i < rainCount; i++) {
            rainPos[i * 3] = (Math.random() - 0.5) * 10;
            rainPos[i * 3 + 1] = Math.random() * 8 - 2;
            rainPos[i * 3 + 2] = (Math.random() - 0.5) * 6;
        }
        rainGeom.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
        const rainMat = new THREE.PointsMaterial({
            color: 0x5566aa,
            size: 0.03,
            transparent: true,
            opacity: 0.5,
        });
        this.sceneObjects.rain = new THREE.Points(rainGeom, rainMat);
        this.scene.add(this.sceneObjects.rain);
    }

    updateStorm(time, breathScale) {
        // Lightning flashes
        if (this.sceneObjects.lightnings) {
            this.sceneObjects.lightnings.forEach((lightning, i) => {
                if (time > lightning.userData.nextFlash) {
                    lightning.material.opacity = 1;
                    lightning.userData.nextFlash = time + 2 + Math.random() * 4;
                    // Regenerate bolt path
                    const pos = lightning.geometry.attributes.position.array;
                    let y = 3, x = (i - 1) * 2;
                    for (let j = 0; j < 8; j++) {
                        pos[j * 3] = x;
                        pos[j * 3 + 1] = y;
                        y -= 0.5;
                        x += (Math.random() - 0.5) * 0.8;
                    }
                    lightning.geometry.attributes.position.needsUpdate = true;
                } else {
                    lightning.material.opacity *= 0.85;
                }
            });
        }
        // Rain falling
        if (this.sceneObjects.rain) {
            const pos = this.sceneObjects.rain.geometry.attributes.position.array;
            for (let i = 0; i < pos.length / 3; i++) {
                pos[i * 3 + 1] -= 0.15;
                if (pos[i * 3 + 1] < -3) pos[i * 3 + 1] = 5;
            }
            this.sceneObjects.rain.geometry.attributes.position.needsUpdate = true;
        }
        // Clouds drifting
        if (this.sceneObjects.clouds) {
            this.sceneObjects.clouds.forEach((cloud, i) => {
                cloud.position.x += Math.sin(time * 0.1 + i) * 0.002;
            });
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SOLAR FLARE - Sun with corona
    // ═══════════════════════════════════════════════════════════════════════════

    createSolarScene() {
        const c = this.techniqueParams.color || { r: 255, g: 180, b: 50 };

        // Sun core
        const sunGeom = new THREE.SphereGeometry(1.2, 32, 32);
        const sunMat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uColor: { value: new THREE.Color(c.r / 255, c.g / 255, c.b / 255) },
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
                varying vec2 vUv;
                float noise(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
                void main() {
                    vec2 uv = vUv * 5.0;
                    float n = noise(uv + uTime * 0.5) * 0.3;
                    vec3 color = uColor + vec3(n, n * 0.5, 0.0);
                    gl_FragColor = vec4(color, 1.0);
                }
            `,
        });
        this.sceneObjects.sun = new THREE.Mesh(sunGeom, sunMat);
        this.scene.add(this.sceneObjects.sun);

        // Corona glow layers
        this.sceneObjects.corona = [];
        for (let i = 0; i < 3; i++) {
            const coronaGeom = new THREE.RingGeometry(1.3 + i * 0.3, 1.5 + i * 0.4, 64);
            const coronaMat = new THREE.MeshBasicMaterial({
                color: new THREE.Color(c.r / 255, c.g / 255, c.b / 255),
                transparent: true,
                opacity: 0.3 - i * 0.08,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
            });
            const corona = new THREE.Mesh(coronaGeom, coronaMat);
            this.sceneObjects.corona.push(corona);
            this.scene.add(corona);
        }

        // Solar wind particles
        const windCount = this.quality.particleCount;
        const windGeom = new THREE.BufferGeometry();
        const windPos = new Float32Array(windCount * 3);
        const windAngles = new Float32Array(windCount);
        for (let i = 0; i < windCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const radius = 1.5 + Math.random() * 3;
            windPos[i * 3] = Math.cos(angle) * radius;
            windPos[i * 3 + 1] = Math.sin(angle) * radius;
            windPos[i * 3 + 2] = (Math.random() - 0.5) * 2;
            windAngles[i] = angle;
        }
        windGeom.setAttribute('position', new THREE.BufferAttribute(windPos, 3));
        this.solarWindAngles = windAngles;
        const windMat = new THREE.PointsMaterial({
            color: 0xffcc66,
            size: 0.04,
            transparent: true,
            opacity: 0.7,
            blending: THREE.AdditiveBlending,
        });
        this.sceneObjects.solarWind = new THREE.Points(windGeom, windMat);
        this.scene.add(this.sceneObjects.solarWind);
    }

    updateSolar(time, breathScale) {
        if (this.sceneObjects.sun) {
            this.sceneObjects.sun.material.uniforms.uTime.value = time;
            this.sceneObjects.sun.scale.setScalar(breathScale);
        }
        if (this.sceneObjects.corona) {
            this.sceneObjects.corona.forEach((corona, i) => {
                corona.scale.setScalar(breathScale + Math.sin(time * 2 + i) * 0.05 * this.intensity);
                corona.rotation.z = time * 0.1 * (i % 2 === 0 ? 1 : -1);
            });
        }
        if (this.sceneObjects.solarWind && this.solarWindAngles) {
            const pos = this.sceneObjects.solarWind.geometry.attributes.position.array;
            for (let i = 0; i < this.solarWindAngles.length; i++) {
                let radius = Math.sqrt(pos[i * 3] ** 2 + pos[i * 3 + 1] ** 2);
                radius += 0.03 * (0.5 + this.intensity);
                if (radius > 5) radius = 1.5;
                pos[i * 3] = Math.cos(this.solarWindAngles[i]) * radius;
                pos[i * 3 + 1] = Math.sin(this.solarWindAngles[i]) * radius;
            }
            this.sceneObjects.solarWind.geometry.attributes.position.needsUpdate = true;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // HEART GLOW - Pulsing 3D heart
    // ═══════════════════════════════════════════════════════════════════════════

    createHeartScene() {
        const c = this.techniqueParams.color || { r: 255, g: 100, b: 150 };

        // Create heart shape using parametric equation
        const heartShape = new THREE.Shape();
        const scale = 0.05;
        for (let t = 0; t <= Math.PI * 2; t += 0.1) {
            const x = 16 * Math.pow(Math.sin(t), 3);
            const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
            if (t === 0) heartShape.moveTo(x * scale, y * scale);
            else heartShape.lineTo(x * scale, y * scale);
        }

        const heartGeom = new THREE.ExtrudeGeometry(heartShape, { depth: 0.3, bevelEnabled: true, bevelSize: 0.1, bevelThickness: 0.1 });
        const heartMat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(c.r / 255, c.g / 255, c.b / 255),
            transparent: true,
            opacity: 0.9,
        });
        this.sceneObjects.heart = new THREE.Mesh(heartGeom, heartMat);
        // Heart is already upright from parametric equation, no rotation needed
        this.sceneObjects.heart.position.y = 0.3;
        this.scene.add(this.sceneObjects.heart);

        // Glow rings
        this.sceneObjects.heartRings = [];
        for (let i = 0; i < 5; i++) {
            const ringGeom = new THREE.RingGeometry(1 + i * 0.5, 1.1 + i * 0.5, 32);
            const ringMat = new THREE.MeshBasicMaterial({
                color: new THREE.Color(c.r / 255, c.g / 255, c.b / 255),
                transparent: true,
                opacity: 0.3 - i * 0.05,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
            });
            const ring = new THREE.Mesh(ringGeom, ringMat);
            ring.userData.baseRadius = 1 + i * 0.5;
            this.sceneObjects.heartRings.push(ring);
            this.scene.add(ring);
        }

        // Love particles floating upward
        const loveCount = Math.floor(this.quality.particleCount * 0.3);
        const loveGeom = new THREE.BufferGeometry();
        const lovePos = new Float32Array(loveCount * 3);
        for (let i = 0; i < loveCount; i++) {
            lovePos[i * 3] = (Math.random() - 0.5) * 4;
            lovePos[i * 3 + 1] = Math.random() * 6 - 3;
            lovePos[i * 3 + 2] = (Math.random() - 0.5) * 2;
        }
        loveGeom.setAttribute('position', new THREE.BufferAttribute(lovePos, 3));
        const loveMat = new THREE.PointsMaterial({
            color: 0xff88aa,
            size: 0.06,
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending,
        });
        this.sceneObjects.loveParticles = new THREE.Points(loveGeom, loveMat);
        this.scene.add(this.sceneObjects.loveParticles);
    }

    updateHeart(time, breathScale) {
        if (this.sceneObjects.heart) {
            const pulse = 1 + Math.sin(time * 2) * 0.15 * this.intensity;
            this.sceneObjects.heart.scale.setScalar(breathScale * pulse);
        }
        if (this.sceneObjects.heartRings) {
            this.sceneObjects.heartRings.forEach((ring, i) => {
                const expand = (time * 0.5 + i * 0.2) % 1;
                ring.scale.setScalar(1 + expand * 0.5);
                ring.material.opacity = (1 - expand) * 0.2 * this.intensity;
            });
        }
        if (this.sceneObjects.loveParticles) {
            const pos = this.sceneObjects.loveParticles.geometry.attributes.position.array;
            for (let i = 0; i < pos.length / 3; i++) {
                pos[i * 3 + 1] += 0.02;
                if (pos[i * 3 + 1] > 4) pos[i * 3 + 1] = -3;
            }
            this.sceneObjects.loveParticles.geometry.attributes.position.needsUpdate = true;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MOONLIT WATERS - Moon with reflections
    // ═══════════════════════════════════════════════════════════════════════════

    createMoonlitScene() {
        const c = this.techniqueParams.color || { r: 150, g: 180, b: 255 };

        // Night sky gradient (dark)
        // Use fog instead of background for transparency
        this.scene.fog = new THREE.FogExp2(0x050510, 0.03);

        // Moon
        const moonGeom = new THREE.SphereGeometry(0.8, 32, 32);
        const moonMat = new THREE.MeshBasicMaterial({ color: 0xffffee });
        this.sceneObjects.moon = new THREE.Mesh(moonGeom, moonMat);
        this.sceneObjects.moon.position.set(2, 2, -5);
        this.scene.add(this.sceneObjects.moon);

        // Moon glow
        const glowGeom = new THREE.SphereGeometry(1.2, 32, 32);
        const glowMat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(c.r / 255, c.g / 255, c.b / 255),
            transparent: true,
            opacity: 0.2,
            blending: THREE.AdditiveBlending,
        });
        this.sceneObjects.moonGlow = new THREE.Mesh(glowGeom, glowMat);
        this.sceneObjects.moonGlow.position.copy(this.sceneObjects.moon.position);
        this.scene.add(this.sceneObjects.moonGlow);

        // Water surface
        const waterGeom = new THREE.PlaneGeometry(12, 6, 64, 32);
        const waterMat = new THREE.ShaderMaterial({
            uniforms: { uTime: { value: 0 }, uMoonPos: { value: new THREE.Vector2(0.6, 0.7) } },
            vertexShader: `
                uniform float uTime;
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    vec3 pos = position;
                    pos.z = sin(pos.x * 4.0 + uTime) * 0.05 + sin(pos.y * 3.0 - uTime * 0.5) * 0.03;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform vec2 uMoonPos;
                varying vec2 vUv;
                void main() {
                    vec3 waterColor = vec3(0.05, 0.08, 0.15);
                    float moonPath = smoothstep(0.15, 0.0, abs(vUv.x - uMoonPos.x));
                    moonPath *= smoothstep(0.0, 1.0, vUv.y);
                    float shimmer = sin(vUv.x * 50.0 + uTime * 3.0) * 0.3 + 0.7;
                    vec3 color = waterColor + vec3(0.8, 0.85, 0.9) * moonPath * shimmer * 0.4;
                    gl_FragColor = vec4(color, 0.9);
                }
            `,
            transparent: true,
        });
        this.sceneObjects.water = new THREE.Mesh(waterGeom, waterMat);
        this.sceneObjects.water.rotation.x = -Math.PI * 0.35;
        this.sceneObjects.water.position.y = -1.5;
        this.scene.add(this.sceneObjects.water);

        // Stars
        const starCount = this.quality.particleCount;
        const starGeom = new THREE.BufferGeometry();
        const starPos = new Float32Array(starCount * 3);
        for (let i = 0; i < starCount; i++) {
            starPos[i * 3] = (Math.random() - 0.5) * 20;
            starPos[i * 3 + 1] = Math.random() * 8;
            starPos[i * 3 + 2] = -8 - Math.random() * 5;
        }
        starGeom.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
        const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.02, transparent: true, opacity: 0.7 });
        this.sceneObjects.stars = new THREE.Points(starGeom, starMat);
        this.scene.add(this.sceneObjects.stars);
    }

    updateMoonlit(time, breathScale) {
        if (this.sceneObjects.water) {
            this.sceneObjects.water.material.uniforms.uTime.value = time;
        }
        if (this.sceneObjects.moonGlow) {
            this.sceneObjects.moonGlow.scale.setScalar(1 + Math.sin(time) * 0.1 * this.intensity);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SACRED GEOMETRY - Rotating Metatron's cube
    // ═══════════════════════════════════════════════════════════════════════════

    createSacredGeometryScene() {
        const c = this.techniqueParams.color || { r: 200, g: 150, b: 255 };
        const c2 = this.techniqueParams.secondaryColor || { r: 255, g: 200, b: 100 };

        // Create Metatron's cube with wireframe
        const geomGroup = new THREE.Group();

        // Central circle
        const centerGeom = new THREE.RingGeometry(0.3, 0.35, 32);
        const centerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(c.r / 255, c.g / 255, c.b / 255), side: THREE.DoubleSide });
        geomGroup.add(new THREE.Mesh(centerGeom, centerMat));

        // Inner hexagon of circles
        for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2;
            const ringGeom = new THREE.RingGeometry(0.25, 0.3, 32);
            const ring = new THREE.Mesh(ringGeom, centerMat.clone());
            ring.position.set(Math.cos(angle) * 0.8, Math.sin(angle) * 0.8, 0);
            geomGroup.add(ring);
        }

        // Outer hexagon
        for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
            const ringGeom = new THREE.RingGeometry(0.2, 0.25, 32);
            const ring = new THREE.Mesh(ringGeom, centerMat.clone());
            ring.position.set(Math.cos(angle) * 1.4, Math.sin(angle) * 1.4, 0);
            geomGroup.add(ring);
        }

        // Connecting lines
        const lineMat = new THREE.LineBasicMaterial({ color: new THREE.Color(c2.r / 255, c2.g / 255, c2.b / 255), transparent: true, opacity: 0.6 });
        for (let i = 0; i < 6; i++) {
            const angle1 = (i / 6) * Math.PI * 2;
            const angle2 = ((i + 1) % 6 / 6) * Math.PI * 2;
            const points = [
                new THREE.Vector3(Math.cos(angle1) * 0.8, Math.sin(angle1) * 0.8, 0),
                new THREE.Vector3(Math.cos(angle2) * 0.8, Math.sin(angle2) * 0.8, 0)
            ];
            geomGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lineMat));
            // Lines to center
            geomGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), points[0]]), lineMat));
        }

        this.sceneObjects.geometry = geomGroup;
        this.scene.add(geomGroup);

        // Second rotating layer
        const layer2 = geomGroup.clone();
        layer2.scale.setScalar(0.7);
        this.sceneObjects.geometry2 = layer2;
        this.scene.add(layer2);

        // Particles
        const partCount = Math.floor(this.quality.particleCount * 0.3);
        const partGeom = new THREE.BufferGeometry();
        const partPos = new Float32Array(partCount * 3);
        for (let i = 0; i < partCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const radius = Math.random() * 2.5;
            partPos[i * 3] = Math.cos(angle) * radius;
            partPos[i * 3 + 1] = Math.sin(angle) * radius;
            partPos[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
        }
        partGeom.setAttribute('position', new THREE.BufferAttribute(partPos, 3));
        const partMat = new THREE.PointsMaterial({ color: 0xffd700, size: 0.03, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending });
        this.sceneObjects.geoParticles = new THREE.Points(partGeom, partMat);
        this.scene.add(this.sceneObjects.geoParticles);
    }

    updateSacredGeometry(time, breathScale) {
        if (this.sceneObjects.geometry) {
            this.sceneObjects.geometry.rotation.z = time * 0.1;
            this.sceneObjects.geometry.scale.setScalar(breathScale);
        }
        if (this.sceneObjects.geometry2) {
            this.sceneObjects.geometry2.rotation.z = -time * 0.08;
            this.sceneObjects.geometry2.scale.setScalar(breathScale * 0.7);
        }
        if (this.sceneObjects.geoParticles) {
            this.sceneObjects.geoParticles.rotation.z = time * 0.05;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CRYSTAL PRISM - Rainbow refraction
    // ═══════════════════════════════════════════════════════════════════════════

    createCrystalScene() {
        // Crystal prism (tetrahedron)
        const prismGeom = new THREE.TetrahedronGeometry(1.5, 0);
        const prismMat = new THREE.MeshBasicMaterial({
            color: 0xaaffff,
            transparent: true,
            opacity: 0.4,
            wireframe: false,
        });
        this.sceneObjects.prism = new THREE.Mesh(prismGeom, prismMat);
        this.scene.add(this.sceneObjects.prism);

        // Wireframe overlay
        const wireframeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.8 });
        this.sceneObjects.prismWire = new THREE.Mesh(prismGeom.clone(), wireframeMat);
        this.scene.add(this.sceneObjects.prismWire);

        // Rainbow beams (colored lines emanating)
        const colors = [0xff0000, 0xff7700, 0xffff00, 0x00ff00, 0x0000ff, 0x8800ff];
        this.sceneObjects.rainbowBeams = [];
        colors.forEach((color, i) => {
            const beamGeom = new THREE.PlaneGeometry(0.1, 4);
            const beamMat = new THREE.MeshBasicMaterial({
                color: color,
                transparent: true,
                opacity: 0.5,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
            });
            const beam = new THREE.Mesh(beamGeom, beamMat);
            beam.position.set(0, -2, 0);
            beam.rotation.z = -0.3 + i * 0.12;
            this.sceneObjects.rainbowBeams.push(beam);
            this.scene.add(beam);
        });

        // Sparkle particles
        const sparkleCount = Math.floor(this.quality.particleCount * 0.4);
        const sparkleGeom = new THREE.BufferGeometry();
        const sparklePos = new Float32Array(sparkleCount * 3);
        const sparkleColors = new Float32Array(sparkleCount * 3);
        for (let i = 0; i < sparkleCount; i++) {
            sparklePos[i * 3] = (Math.random() - 0.5) * 6;
            sparklePos[i * 3 + 1] = (Math.random() - 0.5) * 6;
            sparklePos[i * 3 + 2] = (Math.random() - 0.5) * 3;
            // Random rainbow colors
            const hue = Math.random();
            const rgb = new THREE.Color().setHSL(hue, 1, 0.7);
            sparkleColors[i * 3] = rgb.r;
            sparkleColors[i * 3 + 1] = rgb.g;
            sparkleColors[i * 3 + 2] = rgb.b;
        }
        sparkleGeom.setAttribute('position', new THREE.BufferAttribute(sparklePos, 3));
        sparkleGeom.setAttribute('color', new THREE.BufferAttribute(sparkleColors, 3));
        const sparkleMat = new THREE.PointsMaterial({ size: 0.05, vertexColors: true, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending });
        this.sceneObjects.sparkles = new THREE.Points(sparkleGeom, sparkleMat);
        this.scene.add(this.sceneObjects.sparkles);
    }

    updateCrystal(time, breathScale) {
        if (this.sceneObjects.prism) {
            this.sceneObjects.prism.rotation.y = time * 0.3;
            this.sceneObjects.prism.rotation.x = Math.sin(time * 0.5) * 0.2;
            this.sceneObjects.prism.scale.setScalar(breathScale);
        }
        if (this.sceneObjects.prismWire) {
            this.sceneObjects.prismWire.rotation.copy(this.sceneObjects.prism.rotation);
            this.sceneObjects.prismWire.scale.setScalar(breathScale * 1.01);
        }
        if (this.sceneObjects.rainbowBeams) {
            this.sceneObjects.rainbowBeams.forEach((beam, i) => {
                beam.material.opacity = 0.3 + Math.sin(time * 2 + i) * 0.2 * this.intensity;
            });
        }
        if (this.sceneObjects.sparkles) {
            this.sceneObjects.sparkles.rotation.y = time * 0.1;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ZEN GARDEN - Sand, stones, koi, blossoms
    // ═══════════════════════════════════════════════════════════════════════════

    createZenGardenScene() {
        const c = this.techniqueParams.color || { r: 180, g: 200, b: 180 };

        // Sand plane
        const sandGeom = new THREE.PlaneGeometry(8, 8, 64, 64);
        const sandMat = new THREE.ShaderMaterial({
            uniforms: { uTime: { value: 0 }, uIntensity: { value: 0.5 } },
            vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: `
                uniform float uTime;
                uniform float uIntensity;
                varying vec2 vUv;
                void main() {
                    vec2 center = vec2(0.5);
                    float dist = length(vUv - center);
                    float rake = sin(dist * 40.0 - uIntensity * 3.0) * 0.5 + 0.5;
                    rake = pow(rake, 0.5);
                    vec3 sandColor = vec3(0.85, 0.82, 0.75);
                    sandColor -= rake * 0.05;
                    float ripple = sin(dist * 25.0 - uTime * 2.0) * exp(-dist * 2.0) * 0.1;
                    sandColor += vec3(0.6, 0.7, 0.6) * ripple * uIntensity;
                    gl_FragColor = vec4(sandColor, 1.0);
                }
            `,
        });
        this.sceneObjects.sand = new THREE.Mesh(sandGeom, sandMat);
        this.sceneObjects.sand.rotation.x = -Math.PI * 0.5;
        this.sceneObjects.sand.position.y = -1;
        this.scene.add(this.sceneObjects.sand);

        // Stones
        this.sceneObjects.stones = [];
        const stonePositions = [[-1, 0.5], [1.2, -0.3], [0, -1]];
        stonePositions.forEach(([x, z]) => {
            const stoneGeom = new THREE.SphereGeometry(0.2 + Math.random() * 0.1, 16, 16);
            const stoneMat = new THREE.MeshBasicMaterial({ color: 0x556655 });
            const stone = new THREE.Mesh(stoneGeom, stoneMat);
            stone.position.set(x, -0.85, z);
            stone.scale.y = 0.6;
            this.sceneObjects.stones.push(stone);
            this.scene.add(stone);
        });

        // Cherry blossom petals falling
        const petalCount = Math.floor(this.quality.particleCount * 0.2);
        const petalGeom = new THREE.BufferGeometry();
        const petalPos = new Float32Array(petalCount * 3);
        for (let i = 0; i < petalCount; i++) {
            petalPos[i * 3] = (Math.random() - 0.5) * 8;
            petalPos[i * 3 + 1] = Math.random() * 4;
            petalPos[i * 3 + 2] = (Math.random() - 0.5) * 4;
        }
        petalGeom.setAttribute('position', new THREE.BufferAttribute(petalPos, 3));
        const petalMat = new THREE.PointsMaterial({ color: 0xffccdd, size: 0.08, transparent: true, opacity: 0.8 });
        this.sceneObjects.petals = new THREE.Points(petalGeom, petalMat);
        this.scene.add(this.sceneObjects.petals);

        // Ambient lighting feel
        const ambientGeom = new THREE.SphereGeometry(10, 16, 16);
        const ambientMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(c.r / 255, c.g / 255, c.b / 255), side: THREE.BackSide, transparent: true, opacity: 0.3 });
        this.sceneObjects.ambient = new THREE.Mesh(ambientGeom, ambientMat);
        this.scene.add(this.sceneObjects.ambient);
    }

    updateZenGarden(time, breathScale) {
        if (this.sceneObjects.sand) {
            this.sceneObjects.sand.material.uniforms.uTime.value = time;
            this.sceneObjects.sand.material.uniforms.uIntensity.value = this.intensity;
        }
        if (this.sceneObjects.petals) {
            const pos = this.sceneObjects.petals.geometry.attributes.position.array;
            for (let i = 0; i < pos.length / 3; i++) {
                pos[i * 3 + 1] -= 0.01;
                pos[i * 3] += Math.sin(time + i) * 0.005;
                if (pos[i * 3 + 1] < -1) pos[i * 3 + 1] = 4;
            }
            this.sceneObjects.petals.geometry.attributes.position.needsUpdate = true;
        }
    }


    resize(width, height) {
        if (!this.renderer) return;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
        if (this.composer) {
            this.composer.setSize(width, height);
        }
    }

    dispose() {
        this.stop();
        this.clearScene();
        if (this.renderer) {
            this.renderer.dispose();
            if (this.renderer.domElement && this.renderer.domElement.parentNode) {
                this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
            }
        }
        if (this.composer) {
            this.composer.dispose();
        }
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.composer = null;
        console.log('[ThreeJSBreathingRenderer] Disposed');
    }
}
