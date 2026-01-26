/**
 * Verdant Hills Theme - WebGPU + TSL Edition
 *
 * A peaceful rolling hills landscape with fluffy grass, stylized trees,
 * and atmospheric gradient fog. Now powered by WebGPU with TSL shaders
 * for improved performance.
 *
 * Features automatic fallback to WebGL2 for browsers without WebGPU support.
 */

import * as THREE from 'three/webgpu';
import {
    // Core TSL nodes
    positionLocal, positionWorld, normalLocal, normalWorld,
    uv, time, uniform, cameraPosition,
    // Math functions
    sin, cos, pow, smoothstep, mix, abs, normalize, dot, max, min, length, fract,
    // Vector construction
    vec2, vec3, vec4, float,
    // Shader utilities
    varying, attribute, instanceIndex,
    // Color utilities
    color,
    // Matrix access
    modelWorldMatrix,
} from 'three/tsl';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';

export default class VerdantHillsTheme extends BaseTheme {
    constructor() {
        super('verdant-hills');
        this.eventUnsubscribers = [];
        this.animationFrameId = null;
        this.lastTime = 0;
        this.clock = new THREE.Clock();

        // Three.js components
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.terrain = null;
        this.grassSystem = null;
        this.trees = [];
        this.particles = null;

        // Animation state
        this.windStrength = 0.5;
        this.windDirection = new THREE.Vector2(1, 0.3).normalize();
        this.targetWindStrength = 0.5;

        // TSL uniforms (will be set during scene creation)
        this.uTime = null;
        this.uWindStrength = null;

        // Graphics quality presets
        this.currentQuality = 'High';
        // OPTIMIZED: Cross-billboard grass (2 quads at 90°) - each looks like 2 blades
        this.qualityPresets = {
            Minimal: {
                grassCount: 3000,
                treeCount: 10,
                particleCount: 50,
                terrainSegments: 64,
            },
            Low: {
                grassCount: 7000,
                treeCount: 25,
                particleCount: 100,
                terrainSegments: 96,
            },
            Medium: {
                grassCount: 14000,
                treeCount: 50,
                particleCount: 200,
                terrainSegments: 128,
            },
            High: {
                grassCount: 25000,
                treeCount: 80,
                particleCount: 300,
                terrainSegments: 160,
            },
            Ultra: {
                grassCount: 40000,
                treeCount: 120,
                particleCount: 500,
                terrainSegments: 200,
            },
            Extreme: {
                grassCount: 60000,
                treeCount: 180,
                particleCount: 800,
                terrainSegments: 256,
            },
        };

        this.activePreset = this.qualityPresets.High;
        this.qualityChangeHandler = null;
    }

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    applyQualityPreset(quality) {
        if (!this.qualityPresets[quality]) {
            console.warn(`[VerdantHillsTheme] Unknown quality preset "${quality}", defaulting to High`);
            quality = 'High';
        }

        this.currentQuality = quality;
        this.activePreset = this.qualityPresets[quality];

        if (this.isActive && this.scene) {
            this.rebuildQualityDependentElements();
        }

        console.log(`🏔️ [VerdantHillsTheme] Applied ${quality} quality preset`);
    }

    rebuildQualityDependentElements() {
        // Rebuild grass with new count
        if (this.grassSystem) {
            this.scene.remove(this.grassSystem);
            this.grassSystem.geometry.dispose();
            this.grassSystem.material.dispose();
        }
        this.createGrass();

        // Rebuild trees
        this.trees.forEach((tree) => {
            this.scene.remove(tree);
            tree.traverse((obj) => {
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) obj.material.dispose();
            });
        });
        this.trees = [];
        this.createTrees();

        // Rebuild particles
        if (this.particles) {
            this.scene.remove(this.particles);
            this.particles.geometry.dispose();
            this.particles.material.dispose();
        }
        this.createParticles();
    }

    setupQualityListener() {
        this.teardownQualityListener();

        this.qualityChangeHandler = (event) => {
            const newQuality = event.detail?.effectQuality;
            if (!newQuality || newQuality === this.currentQuality) return;

            this.applyQualityPreset(newQuality);
        };

        window.addEventListener('settingsChanged', this.qualityChangeHandler);
    }

    teardownQualityListener() {
        if (this.qualityChangeHandler) {
            window.removeEventListener('settingsChanged', this.qualityChangeHandler);
            this.qualityChangeHandler = null;
        }
    }

    async createScene() {
        const themeContainer = document.getElementById('verdant-hills-theme');
        if (!themeContainer) {
            console.error('[VerdantHillsTheme] Theme container not found!');
            return;
        }

        themeContainer.innerHTML = '';
        themeContainer.style.background = '#1a2810';

        // Apply quality preset
        this.applyQualityPreset(this.getGraphicsQuality());
        this.setupQualityListener();

        // Create TSL uniforms for animation
        this.uTime = uniform(0);
        this.uWindStrength = uniform(0.5);

        // Create WebGPU renderer with auto WebGL2 fallback
        this.renderer = new THREE.WebGPURenderer({
            antialias: this.getAntialiasEnabled(),
            powerPreference: 'high-performance',
        });

        // Initialize WebGPU renderer (async - handles fallback automatically)
        try {
            await this.renderer.init();
            console.log(`🏔️ [VerdantHillsTheme] Using ${this.renderer.backend.constructor.name} backend`);
        } catch (error) {
            console.error('[VerdantHillsTheme] Renderer initialization failed:', error);
            return;
        }

        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        this.renderer.setClearColor(0x87ceeb); // Sky blue fallback
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;

        const canvas = this.renderer.domElement;
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.zIndex = '0';
        canvas.style.pointerEvents = 'none';
        themeContainer.appendChild(canvas);

        // Create scene
        this.scene = new THREE.Scene();

        // Create camera - looking down at terrain at an angle
        this.camera = new THREE.PerspectiveCamera(
            60,
            window.innerWidth / window.innerHeight,
            0.1,
            1000,
        );
        this.camera.position.set(0, 80, 120);
        this.camera.lookAt(0, 0, 0);

        // Add fog for atmospheric depth
        this.scene.fog = new THREE.Fog(0xb8d4a8, 50, 350);

        // Create scene elements with TSL materials
        this.createSky();
        this.createTerrain();
        this.createGrass();
        this.createTrees();
        this.createParticles();
        this.createLighting();

        // Setup event listeners
        this.setupEventListeners();

        // Handle initial resize
        this.handleResize();

        // Start animation
        this.clock.start();
        this.startAnimation();

        console.log('🏔️ [VerdantHillsTheme] WebGPU scene created successfully');
    }

    createSky() {
        // Create gradient sky using a large sphere with TSL material
        const skyGeometry = new THREE.SphereGeometry(400, 32, 32);

        // TSL-based sky material
        const skyMaterial = new THREE.MeshBasicNodeMaterial({
            side: THREE.BackSide,
            depthWrite: false,
        });

        // Uniforms for sky colors
        const topColor = uniform(new THREE.Color(0x4a90c2)); // Deep sky blue
        const middleColor = uniform(new THREE.Color(0x87ceeb)); // Light sky blue
        const bottomColor = uniform(new THREE.Color(0xffefd5)); // Warm horizon
        const sunColor = uniform(new THREE.Color(0xffe4b5)); // Sun glow
        const sunPosition = uniform(new THREE.Vector3(100, 60, -150));

        // Calculate sky gradient using TSL
        const worldPos = positionWorld;
        const normalizedPos = normalize(worldPos);
        const height = normalizedPos.y;

        // Upper sky gradient (height > 0)
        const upperGradient = mix(middleColor, topColor, pow(max(height, float(0.0)), float(0.5)));

        // Lower sky gradient (height < 0)
        const lowerGradient = mix(middleColor, bottomColor, pow(max(height.negate(), float(0.0)), float(0.3)));

        // Blend based on height
        const skyColor = mix(lowerGradient, upperGradient, smoothstep(float(-0.01), float(0.01), height));

        // Sun glow effect
        const sunDir = normalize(sunPosition);
        const viewDir = normalizedPos;
        const sunDot = max(dot(viewDir, sunDir), float(0.0));
        const sunGlow = pow(sunDot, float(16.0)).mul(float(0.5)).add(pow(sunDot, float(4.0)).mul(float(0.3)));

        // Final color with sun glow
        const finalColor = mix(skyColor, sunColor, sunGlow);

        skyMaterial.colorNode = finalColor;

        const sky = new THREE.Mesh(skyGeometry, skyMaterial);
        this.scene.add(sky);
    }

    createTerrain() {
        const segments = this.activePreset.terrainSegments;
        const size = 400;

        const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
        geometry.rotateX(-Math.PI / 2);

        // Apply height displacement to create rolling hills
        const positions = geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i);
            const z = positions.getZ(i);
            const y = this.getTerrainHeight(x, z);
            positions.setY(i, y);
        }
        geometry.computeVertexNormals();

        // Store for grass placement
        this.terrainHeightData = { positions, size, segments };

        // TSL-based terrain material
        const terrainMaterial = new THREE.MeshBasicNodeMaterial();

        // Uniforms
        const grassColor1 = uniform(new THREE.Color(0x3d5c28));
        const grassColor2 = uniform(new THREE.Color(0x5a8c3a));
        const fogColor = uniform(new THREE.Color(0xb8d4a8));
        const fogNear = uniform(50);
        const fogFar = uniform(350);

        // Get normals and height
        const vNormal = normalWorld;
        const vHeight = positionLocal.y;
        const vWorldPos = positionWorld;

        // Height-based color variation
        const heightFactor = smoothstep(float(-20.0), float(25.0), vHeight);
        const baseColor = mix(grassColor1, grassColor2, heightFactor);

        // Simple lighting
        const lightDir = normalize(vec3(0.5, 1.0, 0.3));
        const lighting = max(float(0.3), dot(vNormal, lightDir));
        const litColor = baseColor.mul(lighting);

        // Fog
        const dist = length(vWorldPos.sub(cameraPosition));
        const fogFactor = smoothstep(fogNear, fogFar, dist);
        const finalColor = mix(litColor, fogColor, fogFactor);

        terrainMaterial.colorNode = finalColor;

        this.terrain = new THREE.Mesh(geometry, terrainMaterial);
        this.scene.add(this.terrain);
    }

    getTerrainHeight(x, z) {
        // Multi-layered rolling hills
        return Math.sin(x * 0.02) * 20
            + Math.sin(z * 0.015) * 15
            + Math.sin(x * 0.05 + z * 0.03) * 8
            + Math.cos(x * 0.03 - z * 0.02) * 12
            + Math.sin(x * 0.1) * Math.cos(z * 0.08) * 5;
    }

    createGrass() {
        const count = this.activePreset.grassCount;
        const spread = 180;

        // CROSS-BILLBOARD: Two quads at 90° angles for denser look with fewer instances
        const bladeWidth = 0.25;
        const bladeHeight = 2.2;

        // Create cross-billboard geometry (2 quads intersecting at 90°)
        const bladeGeometry = new THREE.BufferGeometry();
        const hw = bladeWidth * 0.5;

        // Two crossed quads - each is a tapered blade shape
        const vertices = new Float32Array([
            // First quad (along X axis)
            -hw, 0, 0,
            hw, 0, 0,
            hw, bladeHeight, 0,
            -hw, 0, 0,
            hw, bladeHeight, 0,
            -hw, bladeHeight, 0,

            // Second quad (along Z axis, rotated 90°)
            0, 0, -hw,
            0, 0, hw,
            0, bladeHeight, hw,
            0, 0, -hw,
            0, bladeHeight, hw,
            0, bladeHeight, -hw,
        ]);

        const uvs = new Float32Array([
            // First quad UVs
            0.0, 0.0,
            1.0, 0.0,
            1.0, 1.0,
            0.0, 0.0,
            1.0, 1.0,
            0.0, 1.0,

            // Second quad UVs
            0.0, 0.0,
            1.0, 0.0,
            1.0, 1.0,
            0.0, 0.0,
            1.0, 1.0,
            0.0, 1.0,
        ]);

        bladeGeometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        bladeGeometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

        // TSL-based grass material
        const grassMaterial = new THREE.MeshBasicNodeMaterial({
            side: THREE.DoubleSide,
        });

        // Color uniforms
        const grassColorBase = uniform(new THREE.Color(0x2d5016));
        const grassColorMid = uniform(new THREE.Color(0x4a7c2e));
        const grassColorTip = uniform(new THREE.Color(0x8bc34a));
        const fogColor = uniform(new THREE.Color(0xb8d4a8));
        const fogNear = uniform(50);
        const fogFar = uniform(350);

        // Access instance attributes
        const aPhase = attribute('aPhase');
        const aColor = attribute('aColor');

        // Get instance world position for wind variation
        const instanceWorldPos = modelWorldMatrix.mul(vec4(0, 0, 0, 1));

        // Height factor from UV.y (0 at bottom, 1 at top)
        const uvY = uv().y;
        const heightFactor = uvY;

        // Multi-frequency wind using TSL
        const windTime = this.uTime.mul(float(1.2));
        const windPhase = aPhase.add(instanceWorldPos.x.mul(float(0.03))).add(instanceWorldPos.z.mul(float(0.03)));

        const wind1 = sin(windTime.add(windPhase)).mul(float(0.6));
        const wind2 = sin(windTime.mul(float(1.5)).add(windPhase.mul(float(1.2)))).mul(float(0.25));
        const wind3 = cos(windTime.mul(float(0.4)).add(windPhase.mul(float(0.8)))).mul(float(0.15));

        const windOffset = wind1.add(wind2).add(wind3)
            .mul(this.uWindStrength)
            .mul(heightFactor)
            .mul(heightFactor);

        // Displace vertex position with wind
        const displaced = positionLocal.add(vec3(
            windOffset,
            abs(windOffset).mul(float(-0.1)).mul(heightFactor),
            windOffset.mul(float(0.25)),
        ));

        grassMaterial.positionNode = displaced;

        // Grass color gradient (base to tip)
        const color1 = mix(grassColorBase, grassColorMid, smoothstep(float(0.0), float(0.5), heightFactor));
        const grassGradient = mix(color1, grassColorTip, smoothstep(float(0.4), float(1.0), heightFactor));

        // Per-instance color variation
        const instanceColorMod = grassGradient.mul(aColor);

        // Ambient occlusion at base
        const aoFactor = float(0.6).add(heightFactor.mul(float(0.4)));
        const aoColor = instanceColorMod.mul(aoFactor);

        // Fog
        const worldPos = positionWorld;
        const dist = length(worldPos.sub(cameraPosition));
        const fogFactor = smoothstep(fogNear, fogFar, dist);
        const finalColor = mix(aoColor, fogColor, fogFactor);

        grassMaterial.colorNode = finalColor;

        // Create instanced mesh
        const grassMesh = new THREE.InstancedMesh(bladeGeometry, grassMaterial, count);

        // Instance attributes
        const phases = new Float32Array(count);
        const colors = new Float32Array(count * 3);
        const dummy = new THREE.Object3D();

        for (let i = 0; i < count; i++) {
            // Random position
            const x = (Math.random() - 0.5) * spread * 2;
            const z = (Math.random() - 0.5) * spread * 2;
            const y = this.getTerrainHeight(x, z);

            dummy.position.set(x, y, z);

            // Random rotation
            dummy.rotation.y = Math.random() * Math.PI * 2;

            // Scale variation
            const scaleXZ = 0.8 + Math.random() * 0.5;
            const scaleY = 0.7 + Math.random() * 0.6;
            dummy.scale.set(scaleXZ, scaleY, scaleXZ);
            dummy.updateMatrix();
            grassMesh.setMatrixAt(i, dummy.matrix);

            // Random phase for wind
            phases[i] = Math.random() * Math.PI * 2;

            // Per-instance color variation (subtle)
            const colorVar = 0.85 + Math.random() * 0.3;
            colors[i * 3] = colorVar;
            colors[i * 3 + 1] = colorVar;
            colors[i * 3 + 2] = colorVar;
        }

        // Add custom attributes
        grassMesh.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
        grassMesh.geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3));

        grassMesh.instanceMatrix.needsUpdate = true;
        grassMesh.frustumCulled = false;

        this.grassSystem = grassMesh;
        this.scene.add(grassMesh);

        console.log(`🌿 [VerdantHillsTheme] Created ${count} grass blades with TSL shaders`);
    }

    createTrees() {
        const count = this.activePreset.treeCount;
        const spread = 160;

        for (let i = 0; i < count; i++) {
            const x = (Math.random() - 0.5) * spread * 2;
            const z = (Math.random() - 0.5) * spread * 2;
            const y = this.getTerrainHeight(x, z);

            // Skip trees in low areas
            if (y < 5) continue;

            const tree = this.createTree();
            tree.position.set(x, y, z);
            tree.rotation.y = Math.random() * Math.PI * 2;

            const scale = 0.8 + Math.random() * 0.5;
            tree.scale.setScalar(scale);

            this.scene.add(tree);
            this.trees.push(tree);
        }
    }

    createTree() {
        const group = new THREE.Group();

        // Trunk - using TSL-compatible node material
        const trunkGeometry = new THREE.CylinderGeometry(0.3, 0.5, 4, 8);
        const trunkMaterial = new THREE.MeshLambertNodeMaterial({ color: 0x5c4033 });
        const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
        trunk.position.y = 2;
        group.add(trunk);

        // Fluffy foliage (multiple spheres for soft look)
        const foliageColors = [0x4a7c2e, 0x5a9c3a, 0x6ab04a, 0x3d6524];

        const foliagePositions = [
            {
                x: 0, y: 5.5, z: 0, r: 2.5,
            },
            {
                x: 1.2, y: 4.5, z: 0.5, r: 1.8,
            },
            {
                x: -1, y: 4.8, z: -0.5, r: 1.6,
            },
            {
                x: 0.3, y: 6.5, z: -0.3, r: 1.5,
            },
            {
                x: -0.5, y: 5, z: 1, r: 1.4,
            },
        ];

        foliagePositions.forEach((pos, idx) => {
            const foliageGeometry = new THREE.SphereGeometry(pos.r, 12, 12);
            const foliageMaterial = new THREE.MeshLambertNodeMaterial({
                color: foliageColors[idx % foliageColors.length],
            });
            const foliage = new THREE.Mesh(foliageGeometry, foliageMaterial);
            foliage.position.set(pos.x, pos.y, pos.z);
            group.add(foliage);
        });

        return group;
    }

    createParticles() {
        const count = this.activePreset.particleCount;
        const spread = 150;

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const velocities = new Float32Array(count * 3);

        for (let i = 0; i < count; i++) {
            positions[i * 3] = (Math.random() - 0.5) * spread * 2;
            positions[i * 3 + 1] = Math.random() * 60 + 5;
            positions[i * 3 + 2] = (Math.random() - 0.5) * spread * 2;

            velocities[i * 3] = (Math.random() - 0.5) * 0.5;
            velocities[i * 3 + 1] = Math.random() * 0.2 - 0.1;
            velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.particleVelocities = velocities;

        // TSL-based points material
        const material = new THREE.PointsNodeMaterial({
            size: 0.4,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        // Set particle color/opacity via TSL
        material.colorNode = vec4(1.0, 1.0, 0.8, 0.6);

        this.particles = new THREE.Points(geometry, material);
        this.scene.add(this.particles);
    }

    createLighting() {
        // Ambient light
        const ambient = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(ambient);

        // Directional light (sun)
        const directional = new THREE.DirectionalLight(0xfff5e0, 1.0);
        directional.position.set(100, 80, -50);
        this.scene.add(directional);

        // Hemisphere light for natural sky/ground illumination
        const hemisphere = new THREE.HemisphereLight(0x87ceeb, 0x3d5c28, 0.4);
        this.scene.add(hemisphere);
    }

    setupEventListeners() {
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            if (this.isActive) {
                // Wind gust on line clear
                this.targetWindStrength = Math.min(2.0, this.windStrength + data.lineCount * 0.3);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            if (this.isActive && data.comboCount > 1) {
                // Stronger wind gust
                this.targetWindStrength = Math.min(3.0, this.windStrength + data.comboCount * 0.4);
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub);

        // Resize listener
        const resizeHandler = () => this.handleResize();
        window.addEventListener('resize', resizeHandler);
        this.eventUnsubscribers.push(() => window.removeEventListener('resize', resizeHandler));
    }

    handleResize() {
        if (!this.renderer || !this.camera) return;

        const width = window.innerWidth;
        const height = window.innerHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    startAnimation() {
        if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);

        const loop = async () => {
            if (!this.isActive) return;

            const time = this.clock.getElapsedTime();

            // Smooth wind strength transition
            this.windStrength += (this.targetWindStrength - this.windStrength) * 0.02;
            this.targetWindStrength += (0.5 - this.targetWindStrength) * 0.01; // Decay to base

            // Update TSL uniforms
            if (this.uTime) {
                this.uTime.value = time;
            }
            if (this.uWindStrength) {
                this.uWindStrength.value = this.windStrength;
            }

            // Animate particles
            if (this.particles && this.particleVelocities) {
                const positions = this.particles.geometry.attributes.position;
                const spread = 150;

                for (let i = 0; i < positions.count; i++) {
                    let x = positions.getX(i) + this.particleVelocities[i * 3] * this.windStrength;
                    let y = positions.getY(i) + this.particleVelocities[i * 3 + 1];
                    let z = positions.getZ(i) + this.particleVelocities[i * 3 + 2] * this.windStrength * 0.5;

                    // Wrap around
                    if (x > spread) x = -spread;
                    if (x < -spread) x = spread;
                    if (z > spread) z = -spread;
                    if (z < -spread) z = spread;
                    if (y < 5) y = 60;
                    if (y > 65) y = 5;

                    positions.setXYZ(i, x, y, z);
                }
                positions.needsUpdate = true;
            }

            // Subtle camera sway
            this.camera.position.x = Math.sin(time * 0.1) * 5;
            this.camera.position.y = 80 + Math.sin(time * 0.15) * 2;

            // Render (async for WebGPU)
            try {
                await this.renderer.renderAsync(this.scene, this.camera);
            } catch (error) {
                console.error('[VerdantHillsTheme] Render error:', error);
            }

            this.animationFrameId = requestAnimationFrame(loop);
        };

        this.animationFrameId = requestAnimationFrame(loop);
    }

    cleanup() {
        super.cleanup();

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        this.teardownQualityListener();

        // Unsubscribe from events
        this.eventUnsubscribers.forEach((unsub) => {
            if (typeof unsub === 'function') unsub();
        });
        this.eventUnsubscribers = [];

        // Dispose Three.js resources
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

        if (this.renderer) {
            this.renderer.dispose();
            this.renderer = null;
        }

        this.scene = null;
        this.camera = null;
        this.terrain = null;
        this.grassSystem = null;
        this.trees = [];
        this.particles = null;
        this.uTime = null;
        this.uWindStrength = null;

        const container = document.getElementById('verdant-hills-theme');
        if (container) {
            container.innerHTML = '';
        }
    }
}
