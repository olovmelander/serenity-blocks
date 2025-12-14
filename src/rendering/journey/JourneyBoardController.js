/**
 * @fileoverview JourneyBoardController - Three.js Journey Board Scene
 *
 * Main controller for the Journey Mode level selection board.
 * Renders a 3D ascending path through 7 chapters with level nodes.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { JourneyPathRenderer } from './JourneyPathRenderer.js';
import { LevelNodeManager } from './LevelNodeManager.js';
import { JourneyCameraController } from './JourneyCameraController.js';
import { JOURNEY_PATH_DATA } from './path-data.js';

/**
 * Quality presets for the Journey Board
 */
const QUALITY_PRESETS = {
    Minimal: {
        enableBloom: false, bloomStrength: 0.3, particleCount: 200, starCount: 500,
    },
    Low: {
        enableBloom: true, bloomStrength: 0.4, particleCount: 400, starCount: 800,
    },
    Medium: {
        enableBloom: true, bloomStrength: 0.5, particleCount: 600, starCount: 1200,
    },
    High: {
        enableBloom: true, bloomStrength: 0.6, particleCount: 1000, starCount: 2000,
    },
    Ultra: {
        enableBloom: true, bloomStrength: 0.7, particleCount: 1500, starCount: 3000,
    },
    Extreme: {
        enableBloom: true, bloomStrength: 0.8, particleCount: 2000, starCount: 4000,
    },
};

/**
 * JourneyBoardController - Main Three.js scene for level selection
 */
export class JourneyBoardController {
    constructor(container) {
        this.container = container;

        // Three.js core
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.composer = null;
        this.clock = new THREE.Clock();

        // Sub-controllers
        this.pathRenderer = null;
        this.nodeManager = null;
        this.cameraController = null;

        // State
        this.isActive = false;
        this.animationFrameId = null;
        this.time = 0;
        this.selectedLevelId = null;
        this.hoveredLevelId = null;

        // Quality
        this.qualityPreset = QUALITY_PRESETS.High;

        // Event callbacks
        this.onLevelSelect = null;
        this.onLevelHover = null;
        this.onEmptyClick = null; // Called when clicking on empty space (no node)

        // Raycaster for interaction
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        // Background elements
        this.stars = null;
        this.nebulaMesh = null;
        this.ambientParticles = null;

        console.log('[JourneyBoard] Controller created');
    }

    // =============================
    // Lifecycle
    // =============================

    /**
     * Initialize the journey board
     * @param {Object} levelData - Level configurations
     * @param {Object} progressData - Player progress data
     */
    async initialize(levelData, progressData) {
        console.log('[JourneyBoard] Initializing...');

        // Get quality settings
        const quality = window.settings?.effectQuality || 'High';
        this.qualityPreset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.High;

        // Create Three.js fundamentals
        this.initRenderer();
        this.initScene();
        this.initCamera();

        // Create background
        this.createStarfield();
        this.createNebula();
        this.createAmbientParticles();

        // Create path
        this.pathRenderer = new JourneyPathRenderer(this.scene);
        await this.pathRenderer.buildPath(JOURNEY_PATH_DATA);

        // Create level nodes
        this.nodeManager = new LevelNodeManager(this.scene, this.pathRenderer.pathCurve);
        await this.nodeManager.createNodes(levelData);
        this.nodeManager.updateFromProgress(progressData);

        // Setup camera controller
        this.cameraController = new JourneyCameraController(
            this.camera,
            this.pathRenderer.pathCurve,
        );

        // Post-processing
        if (this.qualityPreset.enableBloom) {
            this.setupPostProcessing();
        }

        // Setup lighting
        this.setupLighting();

        // Setup interaction
        this.setupInteraction();

        // Start animation
        this.isActive = true;
        this.animate();

        console.log('[JourneyBoard] Initialized successfully');
    }

    initRenderer() {
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance',
        });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(0x050510, 1);
        this.container.appendChild(this.renderer.domElement);
    }

    initScene() {
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x050510, 0.008);
    }

    initCamera() {
        const aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
        this.camera.position.set(0, 5, 30);
        this.camera.lookAt(0, 0, 0);
    }

    setupPostProcessing() {
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        const bloomPass = new UnrealBloomPass(
            new THREE.Vector2(this.container.clientWidth, this.container.clientHeight),
            this.qualityPreset.bloomStrength,
            0.4,
            0.85,
        );
        this.bloomPass = bloomPass;
        this.composer.addPass(bloomPass);
    }

    setupLighting() {
        // Ambient light
        const ambient = new THREE.AmbientLight(0x404080, 0.3);
        this.scene.add(ambient);

        // Main directional light
        const directional = new THREE.DirectionalLight(0xffffff, 0.5);
        directional.position.set(10, 30, 20);
        this.scene.add(directional);

        // Point lights for path glow
        const pathLight1 = new THREE.PointLight(0x6688ff, 0.5, 50);
        pathLight1.position.set(0, 10, 0);
        this.scene.add(pathLight1);
    }

    // =============================
    // Background Elements
    // =============================

    createStarfield() {
        const count = this.qualityPreset.starCount;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;

            // Distribute stars in a large sphere
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const radius = 200 + Math.random() * 300;

            positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
            positions[i3 + 2] = radius * Math.cos(phi);

            // Vary star colors (white to blue to purple)
            const colorMix = Math.random();
            colors[i3] = 0.7 + colorMix * 0.3;
            colors[i3 + 1] = 0.7 + colorMix * 0.3;
            colors[i3 + 2] = 0.9 + colorMix * 0.1;

            sizes[i] = 1 + Math.random() * 2;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        const material = new THREE.PointsMaterial({
            size: 1.5,
            vertexColors: true,
            sizeAttenuation: true,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
        });

        this.stars = new THREE.Points(geometry, material);
        this.scene.add(this.stars);
    }

    createNebula() {
        // Simple gradient plane for nebula background
        const geometry = new THREE.PlaneGeometry(500, 500);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uColor1: { value: new THREE.Color(0x1a0a2e) },
                uColor2: { value: new THREE.Color(0x0a1a2e) },
                uColor3: { value: new THREE.Color(0x2e0a1a) },
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
                uniform vec3 uColor1;
                uniform vec3 uColor2;
                uniform vec3 uColor3;
                varying vec2 vUv;

                void main() {
                    vec2 uv = vUv;
                    float wave = sin(uv.y * 3.0 + uTime * 0.1) * 0.5 + 0.5;
                    vec3 color = mix(uColor1, uColor2, uv.y);
                    color = mix(color, uColor3, wave * 0.3);
                    gl_FragColor = vec4(color, 0.5);
                }
            `,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
        });

        this.nebulaMesh = new THREE.Mesh(geometry, material);
        this.nebulaMesh.position.z = -150;
        this.scene.add(this.nebulaMesh);
    }

    createAmbientParticles() {
        const count = this.qualityPreset.particleCount;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;
            positions[i3] = (Math.random() - 0.5) * 100;
            positions[i3 + 1] = Math.random() * 200 - 50; // Along the vertical path
            positions[i3 + 2] = (Math.random() - 0.5) * 50;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = new THREE.PointsMaterial({
            size: 0.3,
            color: 0x8888ff,
            transparent: true,
            opacity: 0.4,
            blending: THREE.AdditiveBlending,
        });

        this.ambientParticles = new THREE.Points(geometry, material);
        this.scene.add(this.ambientParticles);
    }

    // =============================
    // Interaction
    // =============================

    setupInteraction() {
        const canvas = this.renderer.domElement;

        canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
        canvas.addEventListener('click', this.onClick.bind(this));
        canvas.addEventListener('wheel', this.onWheel.bind(this));

        // Touch support
        canvas.addEventListener('touchstart', this.onTouchStart.bind(this));
        canvas.addEventListener('touchmove', this.onTouchMove.bind(this));
        canvas.addEventListener('touchend', this.onTouchEnd.bind(this));

        // Resize
        window.addEventListener('resize', this.onResize.bind(this));
    }

    onMouseMove(event) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        // Check for level node hover
        this.checkHover();
    }

    onClick(event) {
        if (this.hoveredLevelId !== null) {
            this.selectLevel(this.hoveredLevelId);
        } else {
            // Clicked on empty space - deselect and notify
            if (this.selectedLevelId !== null) {
                this.nodeManager?.setNodeSelected(this.selectedLevelId, false);
                this.selectedLevelId = null;
            }
            this.onEmptyClick?.();
        }
    }

    onWheel(event) {
        event.preventDefault();
        const delta = event.deltaY * 0.001;
        this.cameraController?.scroll(delta);
    }

    onTouchStart(event) {
        if (event.touches.length === 1) {
            const touch = event.touches[0];
            const rect = this.renderer.domElement.getBoundingClientRect();
            this.mouse.x = ((touch.clientX - rect.left) / rect.width) * 2 - 1;
            this.mouse.y = -((touch.clientY - rect.top) / rect.height) * 2 + 1;
            this.touchStartY = touch.clientY;
        }
    }

    onTouchMove(event) {
        if (event.touches.length === 1) {
            const touch = event.touches[0];
            const delta = (this.touchStartY - touch.clientY) * 0.005;
            this.cameraController?.scroll(delta);
            this.touchStartY = touch.clientY;
        }
    }

    onTouchEnd(event) {
        // Check for tap selection
        this.checkHover();
        if (this.hoveredLevelId !== null) {
            this.selectLevel(this.hoveredLevelId);
        }
    }

    onResize() {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();

        this.renderer.setSize(width, height);

        if (this.composer) {
            this.composer.setSize(width, height);
        }
    }

    checkHover() {
        if (!this.nodeManager) return;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const levelId = this.nodeManager.raycast(this.raycaster);

        if (levelId !== this.hoveredLevelId) {
            // Un-hover previous
            if (this.hoveredLevelId !== null) {
                this.nodeManager.setNodeHovered(this.hoveredLevelId, false);
            }

            // Hover new
            this.hoveredLevelId = levelId;
            if (levelId !== null) {
                this.nodeManager.setNodeHovered(levelId, true);
                this.renderer.domElement.style.cursor = 'pointer';
                this.onLevelHover?.(levelId);
            } else {
                this.renderer.domElement.style.cursor = 'default';
                this.onLevelHover?.(null);
            }
        }
    }

    selectLevel(levelId) {
        if (this.selectedLevelId !== null) {
            this.nodeManager.setNodeSelected(this.selectedLevelId, false);
        }

        this.selectedLevelId = levelId;
        this.nodeManager.setNodeSelected(levelId, true);

        // Focus camera on level
        const nodePosition = this.nodeManager.getNodePosition(levelId);
        if (nodePosition) {
            this.cameraController.focusOnNode(nodePosition, 800);
        }

        this.onLevelSelect?.(levelId);
    }

    // =============================
    // Navigation
    // =============================

    /**
     * Pan camera to a specific chapter
     * @param {number} chapterId
     * @param {number} duration - Animation duration in ms
     */
    panToChapter(chapterId, duration = 1500) {
        const chapterPosition = JOURNEY_PATH_DATA.chapterPositions[chapterId - 1] || 0;
        this.cameraController?.panToPosition(chapterPosition, duration);
    }

    /**
     * Focus on a specific level
     * @param {number} levelId
     */
    focusOnLevel(levelId) {
        this.selectLevel(levelId);
    }

    // =============================
    // Animation Loop
    // =============================

    animate() {
        if (!this.isActive) return;

        this.animationFrameId = requestAnimationFrame(() => this.animate());

        const delta = this.clock.getDelta();
        this.time += delta;

        // Update components
        this.pathRenderer?.update(delta);
        this.nodeManager?.update(delta);
        this.cameraController?.update(delta);

        // Update nebula
        if (this.nebulaMesh) {
            this.nebulaMesh.material.uniforms.uTime.value = this.time;
        }

        // Rotate stars slowly
        if (this.stars) {
            this.stars.rotation.y += delta * 0.01;
        }

        // Drift ambient particles
        if (this.ambientParticles) {
            const positions = this.ambientParticles.geometry.attributes.position.array;
            for (let i = 0; i < positions.length; i += 3) {
                positions[i + 1] += delta * 0.5;
                if (positions[i + 1] > 150) positions[i + 1] = -50;
            }
            this.ambientParticles.geometry.attributes.position.needsUpdate = true;
        }

        // Render
        if (this.composer && this.qualityPreset.enableBloom) {
            this.composer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    // =============================
    // Public API
    // =============================

    /**
     * Update progress visualization
     * @param {Object} progressData
     */
    updateProgress(progressData) {
        this.nodeManager?.updateFromProgress(progressData);
        this.pathRenderer?.setProgress(progressData.furthestLevel / 56);
    }

    /**
     * Get currently selected level ID
     */
    getSelectedLevelId() {
        return this.selectedLevelId;
    }

    /**
     * Cleanup and dispose
     */
    dispose() {
        this.isActive = false;

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }

        // Dispose sub-controllers
        this.pathRenderer?.dispose();
        this.nodeManager?.dispose();

        // Dispose scene objects
        this.scene?.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) {
                    obj.material.forEach((m) => m.dispose());
                } else {
                    obj.material.dispose();
                }
            }
        });

        // Dispose renderer
        this.renderer?.dispose();
        this.composer?.dispose?.();

        // Remove canvas
        if (this.renderer?.domElement?.parentNode) {
            this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
        }

        console.log('[JourneyBoard] Disposed');
    }
}

export default JourneyBoardController;
