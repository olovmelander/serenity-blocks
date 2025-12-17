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
    Extreme: { maxCubes: 8000, treeDepth: 8, bloomStrength: 0.4, bloomRadius: 0.5, enablePost: true, reflectorRes: 1024 },
    Ultra: { maxCubes: 6000, treeDepth: 7, bloomStrength: 0.35, bloomRadius: 0.4, enablePost: true, reflectorRes: 1024 },
    High: { maxCubes: 4000, treeDepth: 7, bloomStrength: 0.3, bloomRadius: 0.3, enablePost: true, reflectorRes: 512 },
    Medium: { maxCubes: 2000, treeDepth: 6, bloomStrength: 0.25, bloomRadius: 0.25, enablePost: true, reflectorRes: 512 },
    Low: { maxCubes: 1000, treeDepth: 5, bloomStrength: 0.2, bloomRadius: 0.2, enablePost: false, reflectorRes: 256 },
    Minimal: { maxCubes: 500, treeDepth: 4, bloomStrength: 0.15, bloomRadius: 0.15, enablePost: false, reflectorRes: 256 },
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
        // 1. Base Reflector (Mirror)
        const groundGeo = new THREE.PlaneGeometry(80, 80);
        this.reflector = new Reflector(groundGeo, {
            clipBias: 0.003,
            textureWidth: this.activePreset.reflectorRes * window.devicePixelRatio,
            textureHeight: this.activePreset.reflectorRes * window.devicePixelRatio,
            color: 0x050510, // Dark blueish mirror
        });
        this.reflector.rotation.x = -Math.PI / 2;
        this.reflector.position.y = -0.01;
        this.scene.add(this.reflector);

        // 2. Checkerboard Overlay
        // Create a checkerboard texture
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const context = canvas.getContext('2d');
        context.fillStyle = '#000000'; // Dark squares
        context.fillRect(0, 0, 512, 512);
        context.fillStyle = '#303040'; // Lighter squares (reflectve-ish look)
        // Draw checkerboard
        const size = 64;
        for (let y = 0; y < 512; y += size) {
            for (let x = 0; x < 512; x += size) {
                if ((x / size + y / size) % 2 === 0) {
                    context.fillRect(x, y, size, size);
                }
            }
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(10, 10);

        const overlayGeo = new THREE.PlaneGeometry(80, 80);
        const overlayMat = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity: 0.25, // Let reflection show through
            blending: THREE.AdditiveBlending,
        });

        const overlay = new THREE.Mesh(overlayGeo, overlayMat);
        overlay.rotation.x = -Math.PI / 2;
        overlay.position.y = 0; // Just on top
        this.scene.add(overlay);
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
        this.uniforms.uPulseIntensity.value = 0.3;
    }

    onLineClear(lineCount) {
        this.uniforms.uPulseIntensity.value = 0.5 + lineCount * 0.15;
        if (this.bloomPass && lineCount >= 2) {
            this.bloomPass.strength = this.activePreset.bloomStrength + lineCount * 0.1;
        }
    }

    onCombo(comboCount) {
        this.uniforms.uPulseIntensity.value = Math.min(1.0, 0.6 + comboCount * 0.15);
        if (this.centerLight) {
            this.centerLight.intensity = 0.8 + comboCount * 0.3;
        }
        if (this.bloomPass) {
            this.bloomPass.strength = this.activePreset.bloomStrength + comboCount * 0.08;
        }
    }

    animate() {
        if (!this.isActive) return;

        this.animationFrame = requestAnimationFrame(this.animate.bind(this));

        const elapsed = this.clock.getElapsedTime();
        this.uniforms.uTime.value = elapsed;

        // Update all cube positions and rotations
        if (this.instancedMesh) {
            this.updateInstanceMatrices(elapsed);
        }

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
