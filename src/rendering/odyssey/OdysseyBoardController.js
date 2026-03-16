/**
 * @fileoverview OdysseyBoardController - Three.js Odyssey Board Scene
 *
 * Main controller for the Odyssey Mode level selection board.
 * Renders the 3D Odyssey path with themed level nodes.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OdysseyPathRenderer } from './OdysseyPathRenderer.js';
import { LevelNodeManager } from './LevelNodeManager.js';
import { OdysseyCameraController } from './OdysseyCameraController.js';
import { ChapterEnvironmentManager } from './ChapterEnvironmentManager.js';
import { ODYSSEY_PATH_DATA } from './path-data.js';
import { PostProcessingStack } from './effects/PostProcessingStack.js';
import { resetOdysseyPathLayout, setOdysseyPathLayout } from './path-utils.js';
import {
    applyOdysseyLayoutToLevels,
    buildOdysseyPresentationLayout,
    normalizeOdysseyLayoutData,
    ODYSSEY_LAYOUT_DATA,
} from '../../core/odyssey/data/odyssey-layout.js';
import {
    findScrollableWheelTarget as findSharedScrollableWheelTarget,
    findWheelLockTarget as findSharedWheelLockTarget,
    normalizeWheelDeltaToPixels,
    shouldCaptureWheelInput,
} from '../../utils/wheel-routing.js';

/**
 * Quality presets for the Odyssey Board
 */
const QUALITY_PRESETS = {
    Minimal: {
        enableBloom: false, bloomStrength: 0.3, particleCount: 100, starCount: 300,
    },
    Low: {
        enableBloom: true, bloomStrength: 0.4, particleCount: 200, starCount: 500,
    },
    Medium: {
        enableBloom: true, bloomStrength: 0.5, particleCount: 400, starCount: 800,
    },
    High: {
        enableBloom: true, bloomStrength: 0.6, particleCount: 600, starCount: 1200,
    },
    Ultra: {
        enableBloom: true, bloomStrength: 0.7, particleCount: 900, starCount: 1800,
    },
    Extreme: {
        enableBloom: true, bloomStrength: 0.8, particleCount: 1200, starCount: 2500,
    },
};

const ODYSSEY_WHEEL_LOCK_ATTRIBUTE = 'data-odyssey-wheel-lock';
const ODYSSEY_WHEEL_CAPTURE_OPTIONS = { capture: true, passive: false };
const ODYSSEY_WHEEL_LOCK_ATTRIBUTES = [ODYSSEY_WHEEL_LOCK_ATTRIBUTE, 'data-wheel-lock'];

function derivePresentationLayout(levelData = [], presentationLayout = null, layoutOverride = null) {
    const fallbackLevelPositionsById = Object.fromEntries(
        levelData
            .filter((level) => Number.isFinite(level?.id) && Number.isFinite(level?.pathPosition))
            .map((level) => [level.id, level.pathPosition]),
    );
    const fallbackLayout = {
        controlPoints: presentationLayout?.controlPoints || layoutOverride?.controlPoints || ODYSSEY_LAYOUT_DATA.controlPoints,
        levelPositionsById: {
            ...ODYSSEY_LAYOUT_DATA.levelPositionsById,
            ...fallbackLevelPositionsById,
        },
    };
    const sourceLayout = {
        controlPoints: layoutOverride?.controlPoints || presentationLayout?.controlPoints || fallbackLayout.controlPoints,
        levelPositionsById: {
            ...fallbackLayout.levelPositionsById,
            ...(presentationLayout?.levelPositionsById || {}),
            ...(layoutOverride?.levelPositionsById || {}),
        },
    };

    return buildOdysseyPresentationLayout(
        levelData,
        normalizeOdysseyLayoutData(sourceLayout, fallbackLayout, levelData),
    );
}

function resolveStyleForElement(element) {
    if (typeof getComputedStyle !== 'function' || !element) {
        return null;
    }

    try {
        return getComputedStyle(element);
    } catch {
        return null;
    }
}

export function findWheelLockTarget(target) {
    return findSharedWheelLockTarget(target, ODYSSEY_WHEEL_LOCK_ATTRIBUTES);
}

export function findScrollableWheelTarget(target, styleResolver = resolveStyleForElement) {
    return findSharedScrollableWheelTarget(target, styleResolver);
}

export function normalizeOdysseyWheelDelta(event, viewportHeight = null) {
    return normalizeWheelDeltaToPixels(event, {
        lineHeight: 16,
        pageHeight: viewportHeight,
        clampPx: 240,
    }) * 0.001;
}

function isPointInsideRect(x, y, rect) {
    if (!rect || !Number.isFinite(x) || !Number.isFinite(y)) {
        return false;
    }

    return x >= rect.left
        && x <= rect.right
        && y >= rect.top
        && y <= rect.bottom;
}

export function shouldRouteOdysseyWheel({
    isActive,
    isRenderingPaused,
    containerRect,
    target,
    clientX,
    clientY,
    styleResolver = resolveStyleForElement,
}) {
    if (!isActive || isRenderingPaused || !containerRect) {
        return false;
    }

    if (!isPointInsideRect(clientX, clientY, containerRect)) {
        return false;
    }

    if (!shouldCaptureWheelInput({
        target,
        styleResolver,
        attributeNames: ODYSSEY_WHEEL_LOCK_ATTRIBUTES,
    })) {
        return false;
    }

    return true;
}

/**
 * OdysseyBoardController - Main Three.js scene for level selection
 */
export class OdysseyBoardController {
    constructor(container, options = {}) {
        this.container = container;
        this.editorMode = !!options.editorMode;
        this.layoutOverride = options.layoutOverride || null;

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
        this.environmentManager = null;

        // Enhanced post-processing
        this.postProcessingStack = null;
        this.qualityName = 'High';

        // State
        this.isActive = false;
        this.isRenderingPaused = false;
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

        // Interaction/performance tracking
        this.lastInteractionAt = performance.now();
        this.backgroundLoadQuietWindowMs = 700;
        this.cameraSettledThreshold = 0.0008;
        this.globalEnvProgressThreshold = 0.0005;
        this.globalEnvMaxIntervalMs = 33;
        this.lastGlobalEnvUpdateTime = 0;
        this.lastGlobalEnvUpdateProgress = Number.NaN;
        this.globalAmbientLight = null;
        this.prewarmQueue = [];
        this.queuedPrewarmChapters = new Set();
        this.isPrewarming = false;
        this.prewarmDrainTimer = null;
        this.pendingChapterLoads = new Set();
        this.selectionSequence = 0;
        this.activeSeamBoundaryId = null;
        this.lastCameraProgress = 0;
        this.levelData = [];
        this.progressData = null;
        this.layoutEditor = null;
        this.presentationLayout = derivePresentationLayout();
        this.interactionAttached = false;
        this.boundHandlers = {
            mousemove: this.onMouseMove.bind(this),
            click: this.onClick.bind(this),
            wheel: this.onWheel.bind(this),
            touchstart: this.onTouchStart.bind(this),
            touchmove: this.onTouchMove.bind(this),
            touchend: this.onTouchEnd.bind(this),
            resize: this.onResize.bind(this),
        };

        console.log('[OdysseyBoard] Controller created');
    }

    // =============================
    // Lifecycle
    // =============================

    /**
     * Initialize the odyssey board
     * Structured to yield to the main thread between heavy steps
     * so the loading overlay CSS animations stay smooth.
     *
     * @param {Object} levelData - Level configurations
     * @param {Object} progressData - Player progress data
     */
    async initialize(levelData, progressData, presentationLayout = null) {
        console.log('[OdysseyBoard] Initializing...');
        this.presentationLayout = derivePresentationLayout(levelData, presentationLayout, this.layoutOverride);
        this.levelData = applyOdysseyLayoutToLevels(levelData, this.presentationLayout);
        this.progressData = progressData;
        setOdysseyPathLayout(this.presentationLayout);

        // Get quality settings
        const quality = window.settings?.effectQuality || 'High';
        this.qualityPreset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.High;
        this.qualityName = quality;

        // ─── Step 1: Lightweight Three.js shell (very fast) ───
        this.initRenderer();
        this.initScene();
        this.initCamera();
        this.createStarfield();

        // Yield — let the loading overlay render & animate smoothly
        await this._yieldToMain();

        // ─── Step 2: Load chapter 1 environment ───
        this.environmentManager = new ChapterEnvironmentManager(this.scene, this.renderer, {
            chapterPositions: this.presentationLayout.chapterPositions,
        });
        await this.environmentManager.initialize([1], {
            particleCount: this.qualityPreset.particleCount,
        });

        await this._yieldToMain();

        // ─── Step 3: Load chapter 2 environment ───
        await this.environmentManager.createChapterEnvironment(2);

        await this._yieldToMain();

        // ─── Step 4: Build path ───
        this.pathRenderer = new OdysseyPathRenderer(this.scene);
        await this.pathRenderer.buildPath({
            ...ODYSSEY_PATH_DATA,
            controlPoints: this.presentationLayout.controlPoints,
            chapterPositions: this.presentationLayout.chapterPositions,
        });

        await this._yieldToMain();

        // ─── Step 5: Create level nodes (55 nodes) ───
        this.nodeManager = new LevelNodeManager(this.scene, this.pathRenderer.pathCurve);
        await this.nodeManager.createNodes(this.levelData);
        this.nodeManager.updateFromProgress(progressData);

        await this._yieldToMain();

        // ─── Step 6: Camera, post-processing, lighting, interaction ───
        this.cameraController = new OdysseyCameraController(
            this.camera,
            this.pathRenderer.pathCurve,
            {
                levelPositions: this.presentationLayout.levelPositions,
                chapterPositions: this.presentationLayout.chapterPositions,
                startPosition: this.presentationLayout.levelPositions[0] ?? 0,
            },
        );

        // Connect chapter change events to camera for FOV pulse and post-processing effects
        if (this.environmentManager && this.cameraController) {
            this.environmentManager.setOnChapterChange((chapterId, previousChapter) => {
                this.cameraController.onChapterChange(chapterId);
                console.log(`[OdysseyBoard] Chapter transition: ${previousChapter} → ${chapterId}`);
            });
        }

        if (this.environmentManager) {
            this.environmentManager.updateVisibility(
                this.cameraController.getCurrentPosition(),
                { mode: 'progress' },
            );
        }

        this.setupPostProcessing();
        this.setupLighting();

        await this._yieldToMain();

        if (this.editorMode) {
            await this.initializeLayoutEditor();
        }

        // ─── Step 7: Interaction + start render loop ───
        this.setupInteraction();

        this.isActive = true;
        this.animate();
        this._queueChapterPrewarm(2);

        // Load remaining chapters in background (idle time, one at a time)
        this.environmentManager.loadChaptersInBackground([1, 2], {
            canRunTask: () => this._canRunBackgroundTask(),
            onEnvironmentCreated: (chapterId) => {
                this._queueChapterPrewarm(chapterId);
            },
        });

        console.log('[OdysseyBoard] Initialized successfully');
    }

    async initializeLayoutEditor() {
        const { OdysseyLayoutEditor } = await import('./OdysseyLayoutEditor.js');
        this.layoutEditor = new OdysseyLayoutEditor(this);
        this.layoutEditor.initialize();
    }

    /**
     * Yield to the main thread so CSS animations and repaints can happen.
     * Uses a double-rAF to guarantee a full frame is painted.
     * @private
     */
    _yieldToMain() {
        return new Promise((resolve) => {
            requestAnimationFrame(() => {
                requestAnimationFrame(resolve);
            });
        });
    }

    _markInteraction() {
        this.lastInteractionAt = performance.now();
    }

    _isInteractionIdle() {
        return (performance.now() - this.lastInteractionAt) >= this.backgroundLoadQuietWindowMs;
    }

    _isCameraSettled() {
        if (!this.cameraController) return true;
        if (this.cameraController.isAnimating) return false;

        const currentPosition = Number.isFinite(this.cameraController.currentPosition)
            ? this.cameraController.currentPosition
            : this.cameraController.getCurrentPosition?.();
        const targetPosition = Number.isFinite(this.cameraController.targetPosition)
            ? this.cameraController.targetPosition
            : currentPosition;

        if (!Number.isFinite(currentPosition) || !Number.isFinite(targetPosition)) {
            return true;
        }

        return Math.abs(targetPosition - currentPosition) <= this.cameraSettledThreshold;
    }

    _canRunBackgroundTask() {
        return this._isInteractionIdle() && this._isCameraSettled();
    }

    _queueChapterPrewarm(chapterId) {
        if (!Number.isFinite(chapterId)) return;
        if (this.queuedPrewarmChapters.has(chapterId)) return;

        const env = this.environmentManager?.environments?.get(chapterId);
        if (env?.prewarmed) return;

        this.queuedPrewarmChapters.add(chapterId);
        this.prewarmQueue.push(chapterId);
        this._schedulePrewarmDrain(80);
    }

    _schedulePrewarmDrain(delayMs = 120) {
        if (this.prewarmDrainTimer || this.prewarmQueue.length === 0) return;

        this.prewarmDrainTimer = setTimeout(() => {
            this.prewarmDrainTimer = null;
            this._drainPrewarmQueue().catch((error) => {
                console.warn('[OdysseyBoard] Prewarm drain failed:', error);
            });
        }, delayMs);
    }

    async _drainPrewarmQueue() {
        if (!this.isActive || this.isPrewarming || this.prewarmQueue.length === 0) return;
        if (!this._canRunBackgroundTask()) {
            this._schedulePrewarmDrain(160);
            return;
        }

        const chapterId = this.prewarmQueue.shift();
        this.queuedPrewarmChapters.delete(chapterId);
        this.isPrewarming = true;

        try {
            await this._prewarmChapterEnvironment(chapterId);
        } finally {
            this.isPrewarming = false;
        }

        if (this.prewarmQueue.length > 0) {
            this._schedulePrewarmDrain(60);
        }
    }

    async _prewarmChapterEnvironment(chapterId) {
        if (!this.environmentManager || !this.renderer || !this.scene || !this.camera) return;

        const env = this.environmentManager.environments.get(chapterId);
        if (!env || env.prewarmed) return;

        const { group } = env;
        const previousGroupVisibility = group.visible;
        const frustumOverrides = [];

        group.traverse((child) => {
            if (child?.isMesh || child?.isPoints || child?.isLine || child?.isSprite) {
                frustumOverrides.push({ child, frustumCulled: child.frustumCulled });
                child.frustumCulled = false;
            }
        });

        try {
            // Temporarily force visibility for shader compilation, then restore.
            group.visible = true;

            if (typeof this.renderer.compileAsync === 'function') {
                await this.renderer.compileAsync(this.scene, this.camera);
            } else if (typeof this.renderer.compile === 'function') {
                this.renderer.compile(this.scene, this.camera);
            }

            env.prewarmed = true;
            console.log(`[OdysseyBoard] Prewarmed chapter ${chapterId} shaders`);
        } catch (error) {
            console.warn(`[OdysseyBoard] Shader prewarm failed for chapter ${chapterId}:`, error);
        } finally {
            group.visible = previousGroupVisibility;
            frustumOverrides.forEach(({ child, frustumCulled }) => {
                child.frustumCulled = frustumCulled;
            });
        }
    }

    initRenderer() {
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance',
        });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        // Cap pixel ratio to 1.5 for performance — the Odyssey board doesn't
        // need 2x DPR since it's mostly particles, paths, and glowing orbs
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        this.renderer.setClearColor(0x050510, 1);
        this.container.appendChild(this.renderer.domElement);
    }

    initScene() {
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x050510, 0.008);
    }

    initCamera() {
        const aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 9000);
        this.camera.position.set(0, 5, 30);
        this.camera.lookAt(0, 0, 0);
    }

    setupPostProcessing() {
        // Use enhanced PostProcessingStack instead of basic bloom
        // This provides chromatic aberration, dynamic vignette, and film grain
        // based on quality preset
        try {
            this.postProcessingStack = new PostProcessingStack(
                this.renderer,
                this.scene,
                this.camera,
                this.qualityName,
            );

            // Keep reference to composer for resize handling
            this.composer = this.postProcessingStack.composer;
            this.bloomPass = this.postProcessingStack.passes.bloom || null;

            console.log(`[OdysseyBoard] PostProcessingStack initialized (${this.qualityName})`);
        } catch (error) {
            // Fallback to basic bloom if PostProcessingStack fails
            console.warn('[OdysseyBoard] PostProcessingStack failed, falling back to basic bloom:', error);
            this.composer = new EffectComposer(this.renderer);
            this.composer.addPass(new RenderPass(this.scene, this.camera));

            const bloomPass = new UnrealBloomPass(
                new THREE.Vector2(this.container.clientWidth, this.container.clientHeight),
                this.qualityPreset.bloomStrength || 0.5,
                0.4,
                0.85,
            );
            this.bloomPass = bloomPass;
            this.composer.addPass(bloomPass);
        }
    }

    setupLighting() {
        // Ambient light
        this.globalAmbientLight = new THREE.AmbientLight(0x404080, 0.3);
        this.scene.add(this.globalAmbientLight);
        this.environmentManager?.registerAmbientLight(this.globalAmbientLight);

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

    createGlobalParticleTexture() {
        if (typeof document === 'undefined') return null;
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');

        const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
        grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
        grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.4)');
        grad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');

        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 32, 32);

        return new THREE.CanvasTexture(canvas);
    }

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
            size: 2.0, // Increased size for soft texture
            vertexColors: true,
            sizeAttenuation: true,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            map: this.createGlobalParticleTexture(),
            depthWrite: false,
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
            size: 0.8, // Increased size for texture
            color: 0x8888ff,
            transparent: true,
            opacity: 0.4,
            blending: THREE.AdditiveBlending,
            map: this.createGlobalParticleTexture(),
            depthWrite: false,
        });

        this.ambientParticles = new THREE.Points(geometry, material);
        this.scene.add(this.ambientParticles);
    }

    // =============================
    // Interaction
    // =============================

    setupInteraction() {
        if (this.interactionAttached || !this.renderer?.domElement) {
            return;
        }

        const canvas = this.renderer.domElement;

        canvas.addEventListener('mousemove', this.boundHandlers.mousemove);
        canvas.addEventListener('click', this.boundHandlers.click);

        // Touch support
        canvas.addEventListener('touchstart', this.boundHandlers.touchstart);
        canvas.addEventListener('touchmove', this.boundHandlers.touchmove);
        canvas.addEventListener('touchend', this.boundHandlers.touchend);

        // Resize
        document.addEventListener('wheel', this.boundHandlers.wheel, ODYSSEY_WHEEL_CAPTURE_OPTIONS);
        window.addEventListener('resize', this.boundHandlers.resize);

        this.interactionAttached = true;
    }

    teardownInteraction() {
        if (!this.interactionAttached) {
            return;
        }

        const canvas = this.renderer?.domElement;
        if (canvas) {
            canvas.removeEventListener('mousemove', this.boundHandlers.mousemove);
            canvas.removeEventListener('click', this.boundHandlers.click);
            canvas.removeEventListener('touchstart', this.boundHandlers.touchstart);
            canvas.removeEventListener('touchmove', this.boundHandlers.touchmove);
            canvas.removeEventListener('touchend', this.boundHandlers.touchend);
        }

        document.removeEventListener('wheel', this.boundHandlers.wheel, ODYSSEY_WHEEL_CAPTURE_OPTIONS);
        window.removeEventListener('resize', this.boundHandlers.resize);
        this.interactionAttached = false;
    }

    onMouseMove(event) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        // Check for level node hover
        this.checkHover();
    }

    onClick() {
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
        if (!this.shouldHandleWheelEvent(event)) {
            return;
        }

        const delta = normalizeOdysseyWheelDelta(
            event,
            this.container?.clientHeight || globalThis.window?.innerHeight || 900,
        );
        if (!delta) {
            return;
        }

        event.preventDefault();
        this._markInteraction();
        this.cameraController?.scroll(delta);
    }

    shouldHandleWheelEvent(event) {
        const containerRect = this.container?.getBoundingClientRect?.();
        return shouldRouteOdysseyWheel({
            isActive: this.isActive,
            isRenderingPaused: this.isRenderingPaused,
            containerRect,
            target: event?.target ?? null,
            clientX: event?.clientX,
            clientY: event?.clientY,
        });
    }

    onTouchStart(event) {
        if (event.touches.length === 1) {
            this._markInteraction();
            const touch = event.touches[0];
            const rect = this.renderer.domElement.getBoundingClientRect();
            this.mouse.x = ((touch.clientX - rect.left) / rect.width) * 2 - 1;
            this.mouse.y = -((touch.clientY - rect.top) / rect.height) * 2 + 1;
            this.touchStartY = touch.clientY;
        }
    }

    onTouchMove(event) {
        if (event.touches.length === 1) {
            this._markInteraction();
            const touch = event.touches[0];
            const delta = (this.touchStartY - touch.clientY) * 0.005;
            this.cameraController?.scroll(delta);
            this.touchStartY = touch.clientY;
        }
    }

    onTouchEnd() {
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

        // Resize post-processing stack
        if (this.postProcessingStack) {
            this.postProcessingStack.resize(width, height);
        } else if (this.composer) {
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
        this.travelToLevel(levelId).catch((error) => {
            console.warn('[OdysseyBoard] Level travel failed:', error);
        });
    }

    async travelToLevel(levelId, options = {}) {
        if (!this.nodeManager || !this.cameraController) return false;

        if (this.selectedLevelId !== null) {
            this.nodeManager.setNodeSelected(this.selectedLevelId, false);
        }

        this.selectedLevelId = levelId;
        this.nodeManager.setNodeSelected(levelId, true);
        this._markInteraction();

        const node = this.nodeManager.nodes.get(levelId);
        const nodePosition = this.nodeManager.getNodePosition(levelId);
        if (!node || !nodePosition) {
            this.onLevelSelect?.(levelId, { settled: false, traveled: false });
            return false;
        }

        const selectionId = ++this.selectionSequence;
        const targetChapter = node.config?.chapter ?? 1;
        const targetProgress = node.pathPosition ?? this.cameraController.getCurrentPosition();
        const currentProgress = this.cameraController.getCurrentPosition();
        const currentBlendState = this.environmentManager?.getBlendState(currentProgress);
        const currentChapter = currentBlendState?.activeChapter ?? targetChapter;
        const traveled = currentChapter !== targetChapter;

        if (traveled) {
            await this._requestChapterEnvironment(targetChapter);
            await this.cameraController.travelToPosition(
                targetProgress,
                options.travelDuration ?? this.computeTravelDuration(currentProgress, targetProgress),
            );
        }

        if (selectionId !== this.selectionSequence) {
            return false;
        }

        this.cameraController.setCurrentPosition(targetProgress);
        await this.cameraController.focusOnNode(
            nodePosition,
            traveled ? (options.focusDuration ?? 520) : (options.focusDuration ?? 800),
        );

        if (selectionId !== this.selectionSequence) {
            return false;
        }

        this.onLevelSelect?.(levelId, {
            chapterId: targetChapter,
            settled: true,
            traveled,
        });
        return true;
    }

    // =============================
    // Navigation
    // =============================

    /**
     * Pan camera to a specific chapter
     * @param {number} chapterId
     * @param {number} duration - Animation duration in ms
     */
    async panToChapter(chapterId, duration = 1500) {
        const chapterPosition = this.presentationLayout.chapterPositions?.[chapterId - 1] || 0;
        await this._requestChapterEnvironment(chapterId);
        return this.cameraController?.panToPosition(chapterPosition, duration);
    }

    /**
     * Focus on a specific level
     * @param {number} levelId
     */
    focusOnLevel(levelId) {
        this.travelToLevel(levelId).catch((error) => {
            console.warn('[OdysseyBoard] Focus-on-level failed:', error);
        });
    }

    // =============================
    // Animation Loop
    // =============================

    animate() {
        if (!this.isActive) return;

        this.animationFrameId = requestAnimationFrame(() => this.animate());

        const delta = this.clock.getDelta();
        this.renderFrame(delta);
    }

    renderFrame(delta = 0) {
        this.time += delta;

        // Update components
        this.pathRenderer?.update(delta);
        this.nodeManager?.update(delta);
        this.cameraController?.update(delta);
        this.layoutEditor?.update(delta);

        // Update chapter environments based on camera position
        if (this.environmentManager && this.camera) {
            const cameraProgress = this.cameraController?.getCurrentPosition() ?? 0;
            this._ensureBoundaryAssets(cameraProgress);
            this._handleChapterSeam(cameraProgress);
            this.environmentManager.updateVisibility(cameraProgress, { mode: 'progress' });

            const nowMs = performance.now();
            const progressDelta = Number.isFinite(this.lastGlobalEnvUpdateProgress)
                ? Math.abs(cameraProgress - this.lastGlobalEnvUpdateProgress)
                : Infinity;
            const shouldUpdateGlobalEnvironment = progressDelta > this.globalEnvProgressThreshold
                || (nowMs - this.lastGlobalEnvUpdateTime) >= this.globalEnvMaxIntervalMs;

            if (shouldUpdateGlobalEnvironment) {
                this.environmentManager.updateGlobalEnvironment(cameraProgress);
                this.lastGlobalEnvUpdateTime = nowMs;
                this.lastGlobalEnvUpdateProgress = cameraProgress;
            }

            this.environmentManager.update(delta, this.camera, cameraProgress);
        }

        // Rotate stars slowly
        if (this.stars) {
            this.stars.rotation.y += delta * 0.01;
        }

        // Update and render via PostProcessingStack
        if (this.postProcessingStack) {
            this.postProcessingStack.update(delta);
            this.postProcessingStack.render();
        } else if (this.composer) {
            this.composer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    /**
     * Force a single synchronous render without restarting the board loop.
     * Used immediately before the portal breach snapshot.
     * @param {number} delta
     */
    renderOnce(delta = 0) {
        if (!this.renderer || !this.scene || !this.camera) return;
        this.renderFrame(delta);
    }

    /**
     * Capture the current board frame as a canvas snapshot.
     * Used as a frozen underlay during the orb-portal transition.
     * @returns {HTMLCanvasElement|null}
     */
    captureFrame() {
        const sourceCanvas = this.renderer?.domElement;
        if (!sourceCanvas) return null;

        const canvas = document.createElement('canvas');
        const width = Math.max(1, sourceCanvas.width || sourceCanvas.clientWidth || 1);
        const height = Math.max(1, sourceCanvas.height || sourceCanvas.clientHeight || 1);
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        try {
            ctx.drawImage(sourceCanvas, 0, 0, width, height);
            return canvas;
        } catch (error) {
            console.warn('[OdysseyBoard] Failed to capture frame snapshot:', error);
            return null;
        }
    }

    /**
     * Pause board rendering loop without disposing resources.
     * Safe to call repeatedly.
     */
    pauseRendering() {
        if (this.isRenderingPaused) return;
        this.isRenderingPaused = true;
        this.isActive = false;

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    /**
     * Resume board rendering loop after a pause.
     */
    resumeRendering() {
        if (!this.isRenderingPaused) return;
        if (!this.renderer || !this.scene || !this.camera) return;

        this.isRenderingPaused = false;
        this.isActive = true;
        this.clock.getDelta(); // Reset delta to avoid a huge first frame step.
        this.animate();
    }

    // =============================
    // Public API
    // =============================

    /**
     * Update progress visualization
     * @param {Object} progressData
     */
    updateProgress(progressData) {
        this.progressData = progressData;
        this.nodeManager?.updateFromProgress(progressData);
        this.pathRenderer?.setProgress(progressData.furthestLevel / 56);
    }

    getLayoutData() {
        return {
            controlPoints: this.presentationLayout.controlPoints.map((point) => ({ ...point })),
            levelPositionsById: { ...(this.presentationLayout.levelPositionsById || {}) },
        };
    }

    async applyLayoutOverride(layoutOverride) {
        if (!this.pathRenderer || !this.nodeManager || !this.cameraController || !this.environmentManager) {
            return false;
        }

        const currentPosition = this.cameraController.getCurrentPosition();
        const nextPresentationLayout = derivePresentationLayout(
            this.levelData,
            this.presentationLayout,
            layoutOverride,
        );

        this.presentationLayout = nextPresentationLayout;
        this.layoutOverride = {
            controlPoints: nextPresentationLayout.controlPoints,
            levelPositionsById: { ...nextPresentationLayout.levelPositionsById },
        };
        this.levelData = applyOdysseyLayoutToLevels(this.levelData, nextPresentationLayout);

        setOdysseyPathLayout(this.presentationLayout);
        await this.pathRenderer.rebuildPath({
            ...ODYSSEY_PATH_DATA,
            controlPoints: this.presentationLayout.controlPoints,
            chapterPositions: this.presentationLayout.chapterPositions,
        });

        this.nodeManager.updateLayout(this.levelData, this.pathRenderer.pathCurve);
        if (this.progressData) {
            this.nodeManager.updateFromProgress(this.progressData);
        }

        this.cameraController.applyLayout(this.pathRenderer.pathCurve, {
            levelPositions: this.presentationLayout.levelPositions,
            chapterPositions: this.presentationLayout.chapterPositions,
            startPosition: this.presentationLayout.levelPositions[0] ?? 0,
            preservePosition: currentPosition,
        });

        this.environmentManager.setChapterPositions(this.presentationLayout.chapterPositions);
        this.environmentManager.updateVisibility(currentPosition, { mode: 'progress' });
        this.environmentManager.updateGlobalEnvironment(currentPosition);
        return true;
    }

    computeTravelDuration(fromPosition, toPosition) {
        const distance = Math.abs((toPosition ?? 0) - (fromPosition ?? 0));
        return Math.round(900 + (distance * 2600));
    }

    _handleChapterSeam(cameraProgress) {
        const blendState = this.environmentManager?.getBlendState(cameraProgress);
        const boundaryId = blendState?.inSeam ? blendState.boundaryId : null;
        const direction = this._resolveTravelDirection(cameraProgress);

        if (boundaryId && this.activeSeamBoundaryId !== boundaryId) {
            this.activeSeamBoundaryId = boundaryId;
            const { transition } = blendState;
            let seamIntensity = 0.9;
            if (transition.fxPreset === 'heavy') {
                seamIntensity = 1.15;
            } else if (transition.fxPreset === 'neon') {
                seamIntensity = 1.0;
            }

            this.cameraController?.triggerChapterSeam({
                durationMs: transition.beatDurationMs,
                intensity: seamIntensity,
                direction,
            });
            this.postProcessingStack?.triggerChapterSeam({
                preset: transition.fxPreset,
                intensity: seamIntensity,
            });
            this.pathRenderer?.triggerChapterTransition({
                fromChapter: blendState.sourceChapter,
                toChapter: blendState.targetChapter,
                direction,
                boundaryPosition: blendState.boundaryPosition,
                durationMs: transition.beatDurationMs,
            });
        } else if (!boundaryId) {
            this.activeSeamBoundaryId = null;
        }

        this.lastCameraProgress = cameraProgress;
    }

    _resolveTravelDirection(cameraProgress) {
        const travelDirection = this.cameraController?.getTravelState?.().direction;
        if (travelDirection) {
            return Math.sign(travelDirection) || 1;
        }
        return Math.sign(cameraProgress - this.lastCameraProgress) || 1;
    }

    _ensureBoundaryAssets(cameraProgress) {
        const chapterPositions = this.presentationLayout.chapterPositions || [];
        for (let sourceChapter = 1; sourceChapter < (chapterPositions.length - 1); sourceChapter += 1) {
            const boundaryPosition = chapterPositions[sourceChapter];
            const transition = this.environmentManager?.getBoundaryTransition(sourceChapter);
            if (!Number.isFinite(boundaryPosition) || !transition) continue;

            if (Math.abs(cameraProgress - boundaryPosition) <= transition.preloadDistance) {
                this._requestChapterEnvironment(sourceChapter).catch((error) => {
                    console.warn(`[OdysseyBoard] Boundary preload failed for chapter ${sourceChapter}:`, error);
                });
                this._requestChapterEnvironment(sourceChapter + 1).catch((error) => {
                    console.warn(`[OdysseyBoard] Boundary preload failed for chapter ${sourceChapter + 1}:`, error);
                });
            }
        }
    }

    async _requestChapterEnvironment(chapterId) {
        if (!Number.isFinite(chapterId) || !this.environmentManager) return false;

        const existing = this.environmentManager.environments.get(chapterId);
        if (existing) {
            this._queueChapterPrewarm(chapterId);
            return true;
        }

        if (this.pendingChapterLoads.has(chapterId)) {
            return false;
        }

        this.pendingChapterLoads.add(chapterId);
        try {
            await this.environmentManager.createChapterEnvironment(chapterId);
            this.environmentManager.updateVisibility(this.cameraController?.getCurrentPosition?.() ?? 0, {
                mode: 'progress',
            });
            this._queueChapterPrewarm(chapterId);
            return true;
        } catch (error) {
            console.warn(`[OdysseyBoard] Failed to prepare chapter ${chapterId}:`, error);
            return false;
        } finally {
            this.pendingChapterLoads.delete(chapterId);
        }
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
        this.isRenderingPaused = false;
        this.teardownInteraction();
        resetOdysseyPathLayout();
        this.layoutEditor?.dispose?.();
        this.layoutEditor = null;

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
        if (this.prewarmDrainTimer) {
            clearTimeout(this.prewarmDrainTimer);
            this.prewarmDrainTimer = null;
        }
        this.prewarmQueue.length = 0;
        this.queuedPrewarmChapters.clear();
        this.isPrewarming = false;
        this.pendingChapterLoads.clear();
        this.activeSeamBoundaryId = null;

        // Dispose sub-controllers
        this.environmentManager?.dispose();
        this.pathRenderer?.dispose();
        this.nodeManager?.dispose();

        // Dispose post-processing stack
        this.postProcessingStack?.dispose();

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

        console.log('[OdysseyBoard] Disposed');
    }
}

export default OdysseyBoardController;
