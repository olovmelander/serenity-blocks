# Odyssey Mode Implementation Plan

## Serenity Blocks - Odyssey Mode Technical Specification

**Version**: 1.0
**Author**: Claude Code
**Date**: December 2024
**Status**: Design Phase

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Core Systems Design](#3-core-systems-design)
4. [Journey Board (Three.js World)](#4-journey-board-threejs-world)
5. [Level Configuration System](#5-level-configuration-system)
6. [Gameplay Hybrid System](#6-gameplay-hybrid-system)
7. [Theme Integration](#7-theme-integration)
8. [Data Schema & Configuration](#8-data-schema--configuration)
9. [Implementation Phases](#9-implementation-phases)
10. [File Structure](#10-file-structure)
11. [API Reference](#11-api-reference)
12. [Performance Considerations](#12-performance-considerations)
13. [Future Extensibility](#13-future-extensibility)

---

## 1. Executive Summary

### Vision
Odyssey Mode transforms Serenity Blocks from a traditional puzzle game into an immersive, emotionally-driven experience inspired by Tetris Effect. Players traverse a linear path through 56+ levels spanning seven chapters, each representing a stage of cosmic ascent—from Earth's core to abstract transcendence.

### Key Design Goals
1. **Modularity**: Level parameters, gameplay mechanics, and visuals are fully data-driven
2. **Hybrid Mechanics**: Mix and match rules from Single Player and Infinity modes per level
3. **Visual Fidelity**: High-end Three.js world with smooth theme transitions
4. **Easy Modification**: JSON/JS configuration files for non-programmers to tweak levels
5. **Performance**: Lazy loading, LOD systems, and quality presets

### Compatibility
- Integrates with existing `BaseGameMode` architecture
- Reuses `ThemeManager` for visual themes
- Extends `GameState` with journey-specific tracking
- Compatible with all existing visual themes (56+)

---

## 2. Architecture Overview

### High-Level System Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           JOURNEY MODE                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐  │
│  │  OdysseyMode     │───▶│ OdysseyStateManager│───▶│  LevelRegistry  │  │
│  │  (GameMode)      │    │  (Progression)     │    │  (Level Data)   │  │
│  └────────┬─────────┘    └────────┬─────────┘    └────────┬─────────┘  │
│           │                       │                       │             │
│           ▼                       ▼                       ▼             │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                     OdysseyBoardController                        │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │  │
│  │  │ WorldScene  │  │ PathRenderer│  │ LevelNodes  │              │  │
│  │  │ (Three.js)  │  │ (Spline)    │  │ (Markers)   │              │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘              │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                     GameplayHybridEngine                          │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────┐   │  │
│  │  │ MechanicsMixer  │  │ VictoryCondition │  │ ModifierStack  │   │  │
│  │  │ (SP + Infinity) │  │ Evaluator        │  │ (Per-Level)    │   │  │
│  │  └─────────────────┘  └─────────────────┘  └────────────────┘   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                     ThemeTransitionManager                        │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │  │
│  │  │ ChapterTheme│  │ CrossFader  │  │ OverlayMixer│              │  │
│  │  │ Resolver    │  │             │  │             │              │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘              │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Integration with Existing Systems

```javascript
// OdysseyMode extends existing patterns
class OdysseyMode extends BaseGameMode {
    constructor(dependencies) {
        super(dependencies);

        // Reuse existing managers
        this.themeManager = dependencies.themeManager;
        this.soundManager = dependencies.soundManager;
        this.settingsManager = dependencies.settingsManager;

        // Journey-specific systems
        this.journeyState = new OdysseyStateManager();
        this.boardController = new OdysseyBoardController();
        this.hybridEngine = new GameplayHybridEngine();
        this.transitionManager = new ThemeTransitionManager();
    }
}
```

---

## 3. Core Systems Design

### 3.1 OdysseyMode (Main Entry Point)

**Location**: `src/core/game-modes/OdysseyMode.js`

```javascript
export class OdysseyMode extends BaseGameMode {
    getModeId() { return GAME_MODES.ODYSSEY; }
    getDisplayName() { return 'Odyssey Mode'; }

    // Lifecycle
    async onActivate() { /* Setup board view, load progress */ }
    async onStart() { /* Enter level selection */ }
    async onStop() { /* Save progress, cleanup */ }
    async onDeactivate() { /* Full cleanup */ }

    // Journey-specific
    async enterLevel(levelId) { /* Start gameplay for level */ }
    async completeLevel(results) { /* Handle victory, unlock next */ }
    async returnToBoard() { /* Exit gameplay, show world */ }

    // Board navigation
    navigateToChapter(chapterId) { /* Pan camera to chapter */ }
    selectNode(nodeId) { /* Highlight and preview level */ }
}
```

### 3.2 OdysseyStateManager (Progression Tracking)

**Location**: `src/core/journey/OdysseyStateManager.js`

```javascript
export class OdysseyStateManager {
    constructor() {
        this.currentChapter = 1;
        this.currentLevel = 1;
        this.unlockedLevels = new Set([1]);
        this.completedLevels = new Map(); // levelId → { stars, score, time }
        this.statistics = {
            totalPlayTime: 0,
            totalLinesCleared: 0,
            highestCombo: 0,
            chaptersCompleted: 0,
        };
    }

    // Persistence
    save() { /* localStorage with versioning */ }
    load() { /* Restore state */ }
    reset() { /* New game */ }

    // Progression logic
    isLevelUnlocked(levelId) { return this.unlockedLevels.has(levelId); }
    unlockLevel(levelId) { this.unlockedLevels.add(levelId); }
    completeLevel(levelId, results) { /* Calculate stars, unlock next */ }

    // Statistics
    updateStats(sessionStats) { /* Aggregate stats */ }
    getStarsForChapter(chapterId) { /* Sum stars in chapter */ }
}
```

### 3.3 LevelRegistry (Level Configuration)

**Location**: `src/core/journey/LevelRegistry.js`

```javascript
export class LevelRegistry {
    constructor() {
        this.levels = new Map();
        this.chapters = new Map();
        this.loadLevelData();
    }

    // Access
    getLevel(levelId) { return this.levels.get(levelId); }
    getChapter(chapterId) { return this.chapters.get(chapterId); }
    getLevelsInChapter(chapterId) { /* Filter levels by chapter */ }

    // Queries
    getNextLevel(levelId) { /* Returns next in sequence */ }
    getPreviousLevel(levelId) { /* Returns previous */ }
    getTotalLevels() { return this.levels.size; }

    // Hot-reload support (dev mode)
    reloadLevelData() { /* Re-import level configs */ }
}
```

---

## 4. Journey Board (Three.js World)

### 4.1 OdysseyBoardController

**Location**: `src/rendering/journey/OdysseyBoardController.js`

The Journey Board is a 3D environment where players navigate between levels. It renders the entire journey as a continuous, ascending path.

```javascript
export class OdysseyBoardController {
    constructor(container) {
        // Three.js fundamentals
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 10000);
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });

        // Core components
        this.pathRenderer = new OdysseyPathRenderer();
        this.nodeManager = new LevelNodeManager();
        this.environmentManager = new EnvironmentManager();
        this.cameraController = new OdysseyCameraController(this.camera);

        // Post-processing
        this.composer = new EffectComposer(this.renderer);
        this.setupPostProcessing();
    }

    // Lifecycle
    async initialize() {
        await this.pathRenderer.buildPath(JOURNEY_PATH_DATA);
        await this.nodeManager.createNodes(LEVEL_DATA);
        await this.environmentManager.loadChapterEnvironments();
        this.animate();
    }

    // Navigation
    panToChapter(chapterId, duration = 2000) { /* Smooth camera pan */ }
    focusOnNode(nodeId) { /* Zoom to specific level */ }
    setFreeRoam(enabled) { /* Allow manual camera control */ }

    // Rendering
    animate() {
        requestAnimationFrame(() => this.animate());
        this.update();
        this.composer.render();
    }

    // Cleanup
    dispose() {
        this.scene.traverse(obj => obj.dispose?.());
        this.renderer.dispose();
    }
}
```

### 4.2 OdysseyPathRenderer (The Ascending Path)

**Location**: `src/rendering/journey/OdysseyPathRenderer.js`

Renders the continuous path through all chapters as a 3D spline with visual embellishments.

```javascript
export class OdysseyPathRenderer {
    constructor(scene) {
        this.scene = scene;
        this.pathMesh = null;
        this.pathCurve = null;
        this.chapterMarkers = [];
    }

    async buildPath(pathData) {
        // Create 3D spline from control points
        this.pathCurve = new THREE.CatmullRomCurve3(
            pathData.controlPoints.map(p => new THREE.Vector3(p.x, p.y, p.z))
        );

        // Generate tube geometry along path
        const geometry = new THREE.TubeGeometry(
            this.pathCurve,
            pathData.segments,
            pathData.radius,
            pathData.radialSegments,
            false
        );

        // Shader material with glow and emission
        const material = new THREE.ShaderMaterial({
            vertexShader: pathVertexShader,
            fragmentShader: pathFragmentShader,
            uniforms: {
                uTime: { value: 0 },
                uProgress: { value: 0 },
                uChapterColors: { value: CHAPTER_COLOR_GRADIENT },
                uEmissionIntensity: { value: 1.5 },
            },
            transparent: true,
        });

        this.pathMesh = new THREE.Mesh(geometry, material);
        this.scene.add(this.pathMesh);

        // Add chapter transition markers
        this.addChapterMarkers(pathData.chapterBreakpoints);
    }

    // Updates
    setProgress(normalizedProgress) {
        // Illuminate path up to player's current position
        this.pathMesh.material.uniforms.uProgress.value = normalizedProgress;
    }

    update(deltaTime) {
        this.pathMesh.material.uniforms.uTime.value += deltaTime;
    }
}
```

### 4.3 LevelNodeManager (Level Markers)

**Location**: `src/rendering/journey/LevelNodeManager.js`

Manages the 3D representations of each level along the path.

```javascript
export class LevelNodeManager {
    constructor(scene, pathCurve) {
        this.scene = scene;
        this.pathCurve = pathCurve;
        this.nodes = new Map(); // levelId → NodeObject3D
        this.selectedNode = null;
        this.hoveredNode = null;
    }

    async createNodes(levelData) {
        for (const level of levelData) {
            const node = await this.createNode(level);
            this.nodes.set(level.id, node);
            this.scene.add(node.group);
        }
    }

    async createNode(levelConfig) {
        const group = new THREE.Group();

        // Position along path curve
        const pathPosition = levelConfig.pathPosition; // 0-1
        const point = this.pathCurve.getPointAt(pathPosition);
        group.position.copy(point);

        // Node geometry (glowing orb)
        const coreGeometry = new THREE.IcosahedronGeometry(0.5, 2);
        const coreMaterial = new THREE.ShaderMaterial({
            vertexShader: nodeVertexShader,
            fragmentShader: nodeFragmentShader,
            uniforms: {
                uColor: { value: new THREE.Color(levelConfig.themeColor) },
                uLocked: { value: 1.0 },
                uCompleted: { value: 0.0 },
                uStars: { value: 0 },
                uHovered: { value: 0.0 },
                uSelected: { value: 0.0 },
                uTime: { value: 0 },
            },
            transparent: true,
        });

        const coreMesh = new THREE.Mesh(coreGeometry, coreMaterial);
        group.add(coreMesh);

        // Orbiting elements (for completed levels)
        const orbitals = this.createOrbitals(levelConfig);
        group.add(orbitals);

        // Chapter icon (at chapter start nodes)
        if (levelConfig.isChapterStart) {
            const chapterIcon = await this.loadChapterIcon(levelConfig.chapter);
            group.add(chapterIcon);
        }

        return {
            group,
            coreMesh,
            orbitals,
            config: levelConfig,
            update: (dt) => this.updateNode(group, coreMesh, dt),
        };
    }

    // Interaction
    setNodeState(levelId, state) {
        const node = this.nodes.get(levelId);
        if (!node) return;

        node.coreMesh.material.uniforms.uLocked.value = state.locked ? 1.0 : 0.0;
        node.coreMesh.material.uniforms.uCompleted.value = state.completed ? 1.0 : 0.0;
        node.coreMesh.material.uniforms.uStars.value = state.stars || 0;
    }

    selectNode(levelId) {
        if (this.selectedNode) {
            this.selectedNode.coreMesh.material.uniforms.uSelected.value = 0.0;
        }
        const node = this.nodes.get(levelId);
        if (node) {
            node.coreMesh.material.uniforms.uSelected.value = 1.0;
            this.selectedNode = node;
        }
    }

    // Raycasting for mouse/touch interaction
    raycast(raycaster) {
        const intersects = raycaster.intersectObjects(
            Array.from(this.nodes.values()).map(n => n.coreMesh)
        );
        return intersects.length > 0 ? intersects[0].object.parent.userData.levelId : null;
    }
}
```

### 4.4 EnvironmentManager (Chapter Backdrops)

**Location**: `src/rendering/journey/EnvironmentManager.js`

Manages the background environments that change as the player progresses through chapters.

```javascript
export class EnvironmentManager {
    constructor(scene) {
        this.scene = scene;
        this.environments = new Map(); // chapterId → EnvironmentData
        this.activeEnvironment = null;
        this.transitionProgress = 0;
    }

    async loadChapterEnvironments() {
        const chapterConfigs = [
            { id: 1, name: 'Earth Core', themes: ['crystal-cave', 'geode', 'cinder-drift'] },
            { id: 2, name: 'Deep Ocean', themes: ['ocean', 'bioluminescence', 'luminous-tides'] },
            { id: 3, name: 'Surface World', themes: ['forest', 'meadow', 'tornado', 'summer'] },
            { id: 4, name: 'Mountains', themes: ['mountain', 'himalayan-peak', 'ice-temple'] },
            { id: 5, name: 'Sky', themes: ['nimbus-veil', 'aurora'] },
            { id: 6, name: 'Space', themes: ['galaxy', 'stellar-drift', 'astral-weave'] },
            { id: 7, name: 'Black Hole', themes: ['black-hole', 'nebula-flow', 'fluid-dreams'] },
        ];

        for (const config of chapterConfigs) {
            const env = await this.createEnvironment(config);
            this.environments.set(config.id, env);
        }
    }

    async createEnvironment(config) {
        // Skybox/environment based on primary theme
        const envMap = await this.loadEnvironmentMap(config.themes[0]);

        // Fog settings per chapter
        const fog = this.createChapterFog(config.id);

        // Ambient particles
        const particles = this.createAmbientParticles(config.id);

        return { envMap, fog, particles, config };
    }

    transitionToChapter(chapterId, duration = 3000) {
        const targetEnv = this.environments.get(chapterId);
        if (!targetEnv || targetEnv === this.activeEnvironment) return;

        // Crossfade environments
        gsap.to(this, {
            transitionProgress: 1,
            duration: duration / 1000,
            onUpdate: () => {
                this.blendEnvironments(this.activeEnvironment, targetEnv, this.transitionProgress);
            },
            onComplete: () => {
                this.activeEnvironment = targetEnv;
                this.transitionProgress = 0;
            }
        });
    }

    blendEnvironments(from, to, t) {
        // Blend fog colors
        const fogColor = from.fog.color.clone().lerp(to.fog.color, t);
        this.scene.fog.color.copy(fogColor);

        // Blend skybox (requires shader-based skybox)
        // ... implementation
    }
}
```

### 4.5 OdysseyCameraController

**Location**: `src/rendering/journey/OdysseyCameraController.js`

Handles camera movement, zoom, and transitions in the 3D board.

```javascript
export class OdysseyCameraController {
    constructor(camera, pathCurve) {
        this.camera = camera;
        this.pathCurve = pathCurve;

        // State
        this.mode = 'follow'; // 'follow' | 'free' | 'focus' | 'cinematic'
        this.currentPosition = 0; // 0-1 along path
        this.targetPosition = 0;
        this.lookAtTarget = new THREE.Vector3();

        // Orbit controls for free mode
        this.orbitControls = null;

        // Configuration
        this.config = {
            followOffset: new THREE.Vector3(0, 2, 5),
            followLerpSpeed: 0.05,
            zoomRange: { min: 2, max: 20 },
            focusDistance: 3,
        };
    }

    // Modes
    setFollowMode() {
        this.mode = 'follow';
        this.disableOrbitControls();
    }

    setFreeMode() {
        this.mode = 'free';
        this.enableOrbitControls();
    }

    focusOnNode(nodePosition, duration = 1000) {
        this.mode = 'focus';
        this.disableOrbitControls();

        // Animate camera to focus position
        const targetCamPos = nodePosition.clone().add(new THREE.Vector3(0, 1, this.config.focusDistance));

        gsap.to(this.camera.position, {
            x: targetCamPos.x,
            y: targetCamPos.y,
            z: targetCamPos.z,
            duration: duration / 1000,
            ease: 'power2.inOut',
        });

        gsap.to(this.lookAtTarget, {
            x: nodePosition.x,
            y: nodePosition.y,
            z: nodePosition.z,
            duration: duration / 1000,
            ease: 'power2.inOut',
        });
    }

    playCinematic(keyframes, onComplete) {
        this.mode = 'cinematic';
        this.disableOrbitControls();

        const timeline = gsap.timeline({ onComplete });

        keyframes.forEach((kf, i) => {
            timeline.to(this.camera.position, {
                ...kf.position,
                duration: kf.duration,
                ease: kf.ease || 'power2.inOut',
            }, kf.time || `+=${i === 0 ? 0 : keyframes[i-1].duration}`);

            timeline.to(this.lookAtTarget, {
                ...kf.lookAt,
                duration: kf.duration,
                ease: kf.ease || 'power2.inOut',
            }, '<');
        });
    }

    update(deltaTime) {
        if (this.mode === 'follow') {
            // Smooth follow along path
            this.currentPosition = THREE.MathUtils.lerp(
                this.currentPosition,
                this.targetPosition,
                this.config.followLerpSpeed
            );

            const pathPoint = this.pathCurve.getPointAt(this.currentPosition);
            const pathTangent = this.pathCurve.getTangentAt(this.currentPosition);

            // Position camera with offset
            const camPos = pathPoint.clone().add(this.config.followOffset);
            this.camera.position.lerp(camPos, 0.1);

            // Look ahead on path
            const lookAheadT = Math.min(1, this.currentPosition + 0.02);
            const lookTarget = this.pathCurve.getPointAt(lookAheadT);
            this.lookAtTarget.lerp(lookTarget, 0.1);
        }

        if (this.mode !== 'free') {
            this.camera.lookAt(this.lookAtTarget);
        }
    }

    setTargetPosition(normalizedPosition) {
        this.targetPosition = THREE.MathUtils.clamp(normalizedPosition, 0, 1);
    }
}
```

---

## 5. Level Configuration System

### 5.1 Level Data Schema

**Location**: `src/core/journey/data/levels.js`

Each level is defined by a configuration object that controls all aspects of gameplay.

```javascript
/**
 * Level Configuration Schema
 *
 * @typedef {Object} LevelConfig
 * @property {number} id - Unique level identifier (1-56)
 * @property {string} name - Display name for the level
 * @property {number} chapter - Chapter number (1-7)
 * @property {number} chapterLevel - Position within chapter (1-8)
 * @property {boolean} isChapterStart - First level in chapter
 * @property {boolean} isChapterEnd - Last level in chapter
 * @property {number} pathPosition - Position along journey path (0-1)
 *
 * @property {ThemeConfig} theme - Visual theme configuration
 * @property {MechanicsConfig} mechanics - Gameplay mechanics
 * @property {VictoryConfig} victory - Win/loss conditions
 * @property {ModifiersConfig} modifiers - Active gameplay modifiers
 *
 * @property {StarConfig} stars - Star rating thresholds
 * @property {Object} metadata - Additional display data
 */

export const LEVEL_CONFIGS = [
    // =============================
    // CHAPTER 1: EARTH CORE (Levels 1-8)
    // =============================
    {
        id: 1,
        name: 'First Light',
        chapter: 1,
        chapterLevel: 1,
        isChapterStart: true,
        isChapterEnd: false,
        pathPosition: 0.0,

        theme: {
            primary: 'crystal-cave',
            overlays: [],
            transitionIn: 'fade',
            transitionDuration: 2000,
        },

        mechanics: {
            // Base mode: 'standard' (SinglePlayer rules) or 'infinity' (InfinityMode rules)
            baseMode: 'standard',

            // Board configuration
            board: {
                columns: 10,
                rows: 20,
                startingRows: 0, // Pre-filled rows
            },

            // Speed and timing
            speed: {
                startLevel: 1,
                levelProgression: true, // Speed increases with lines
                fixedDropInterval: null, // Override drop speed (ms)
            },

            // Piece generation
            pieces: {
                bagType: '7-bag', // '7-bag' | 'random' | 'custom'
                customSequence: null, // For puzzle levels
                holdEnabled: true,
                previewCount: 5,
            },
        },

        victory: {
            // Primary condition (must be met to complete)
            primary: {
                type: 'lines', // 'lines' | 'score' | 'time' | 'height' | 'cascade' | 'custom'
                target: 40,
            },

            // Failure condition (triggers level restart)
            failure: {
                type: 'top-out', // 'top-out' | 'time' | 'none'
                value: null,
            },

            // Optional bonus objectives (for stars)
            bonuses: [
                { type: 'no-singles', description: 'Clear no single lines' },
                { type: 'time', target: 120, description: 'Complete in under 2 minutes' },
            ],
        },

        modifiers: {
            // Active modifiers for this level
            active: [],
            // Possible modifiers: 'gravity-cascade', 'big-blocks', 'invisible',
            // 'mirror', 'time-attack', 'combo-multiplier', etc.
        },

        stars: {
            one: { lines: 40 },
            two: { lines: 40, time: 180 },
            three: { lines: 40, time: 120, bonuses: 1 },
        },

        metadata: {
            description: 'Begin your ascent from the crystal depths.',
            difficulty: 1,
            estimatedTime: 180, // seconds
            tip: 'Focus on building flat stacks for efficient clears.',
        },
    },

    // Level 2: Introduction to combos
    {
        id: 2,
        name: 'Ember Cascade',
        chapter: 1,
        chapterLevel: 2,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.018,

        theme: {
            primary: 'cinder-drift',
            overlays: ['bioluminescence'],
            transitionIn: 'crossfade',
            transitionDuration: 3000,
        },

        mechanics: {
            baseMode: 'infinity', // Use Infinity Mode's cascade mechanics

            board: {
                columns: 10,
                rows: 30, // Taller board for cascades
                startingRows: 5, // Some blocks pre-placed
            },

            speed: {
                startLevel: 3,
                levelProgression: false, // Fixed speed
                fixedDropInterval: 700,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                holdEnabled: true,
                previewCount: 5,
            },
        },

        victory: {
            primary: {
                type: 'cascade', // Must trigger cascading line clears
                target: 5, // 5 cascade events
            },

            failure: {
                type: 'top-out',
                value: null,
            },

            bonuses: [
                { type: 'max-cascade-depth', target: 3, description: 'Trigger a 3+ chain cascade' },
            ],
        },

        modifiers: {
            active: ['gravity-cascade'], // Enable Infinity-style gravity
        },

        stars: {
            one: { cascades: 5 },
            two: { cascades: 5, maxCascadeDepth: 2 },
            three: { cascades: 5, maxCascadeDepth: 3, time: 180 },
        },

        metadata: {
            description: 'Learn the power of cascading clears.',
            difficulty: 2,
            estimatedTime: 240,
            tip: 'Build towers with gaps that will collapse when cleared.',
        },
    },

    // ... Continue for all 56 levels

    // Example: Level 50 (Black Hole Chapter - Abstract)
    {
        id: 50,
        name: 'Event Horizon',
        chapter: 7,
        chapterLevel: 2,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.88,

        theme: {
            primary: 'black-hole',
            overlays: ['chromadelic-highway'],
            transitionIn: 'warp',
            transitionDuration: 4000,
        },

        mechanics: {
            baseMode: 'hybrid', // Custom hybrid rules

            board: {
                columns: 10,
                rows: 20,
                startingRows: 8, // High pre-fill
            },

            speed: {
                startLevel: 15,
                levelProgression: true,
                fixedDropInterval: null,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                holdEnabled: true,
                previewCount: 3, // Reduced preview
            },
        },

        victory: {
            primary: {
                type: 'score',
                target: 50000,
            },

            failure: {
                type: 'time',
                value: 300, // 5 minute time limit
            },

            bonuses: [
                { type: 'tetris-count', target: 5, description: 'Clear 5 Tetrises' },
                { type: 'no-top-out', description: 'Never reach the danger zone' },
            ],
        },

        modifiers: {
            active: ['gravity-cascade', 'time-attack', 'combo-multiplier'],
        },

        stars: {
            one: { score: 50000 },
            two: { score: 50000, tetrises: 3 },
            three: { score: 75000, tetrises: 5, time: 180 },
        },

        metadata: {
            description: 'The point of no return approaches.',
            difficulty: 8,
            estimatedTime: 300,
            tip: 'Build for Tetrises while managing the time pressure.',
        },
    },
];

export default LEVEL_CONFIGS;
```

### 5.2 Chapter Configuration

**Location**: `src/core/journey/data/chapters.js`

```javascript
export const CHAPTER_CONFIGS = [
    {
        id: 1,
        name: 'Earth Core & Subterranean Origins',
        subtitle: 'Begin your ascent',
        levelRange: [1, 8],

        themes: {
            primary: ['crystal-cave', 'geode', 'cinder-drift', 'pyrestorm'],
            supporting: ['bioluminescence', 'cosmic-noir'],
        },

        environment: {
            skyColor: 0x1a0a00,
            fogColor: 0x2d1500,
            fogDensity: 0.03,
            ambientLight: 0x331100,
            ambientIntensity: 0.4,
        },

        music: {
            track: 'earth-core',
            crossfadeDuration: 3000,
        },

        narrative: {
            intro: 'The journey begins deep within the Earth\'s core...',
            outro: 'You emerge from the molten depths into liquid worlds...',
        },

        unlockRequirement: null, // First chapter always unlocked
    },

    {
        id: 2,
        name: 'Deep Ocean & Liquid Worlds',
        subtitle: 'Descend into the deep',
        levelRange: [9, 15],

        themes: {
            primary: ['ocean', 'bioluminescence', 'luminous-tides', 'stillwater'],
            supporting: ['waves', 'koi-pond'],
        },

        environment: {
            skyColor: 0x001030,
            fogColor: 0x002040,
            fogDensity: 0.02,
            ambientLight: 0x003366,
            ambientIntensity: 0.5,
        },

        music: {
            track: 'deep-ocean',
            crossfadeDuration: 4000,
        },

        narrative: {
            intro: 'Rock dissolves into water as you descend into the deep...',
            outro: 'Light breaks through as you approach the surface...',
        },

        unlockRequirement: {
            type: 'complete-chapter',
            value: 1,
        },
    },

    // ... Continue for all 7 chapters
];

export default CHAPTER_CONFIGS;
```

---

## 6. Gameplay Hybrid System

### 6.1 GameplayHybridEngine

**Location**: `src/core/journey/GameplayHybridEngine.js`

The hybrid engine allows mixing mechanics from different game modes.

```javascript
export class GameplayHybridEngine {
    constructor(levelConfig) {
        this.config = levelConfig;
        this.mechanicsMixer = new MechanicsMixer();
        this.victoryEvaluator = new VictoryConditionEvaluator();
        this.modifierStack = new ModifierStack();
    }

    /**
     * Creates a GameState configured for the current level
     */
    createGameState() {
        const baseMode = this.config.mechanics.baseMode;

        const options = {
            // Board size
            cols: this.config.mechanics.board.columns,
            rows: this.config.mechanics.board.rows,

            // Infinity mode features
            isInfinityMode: baseMode === 'infinity' || baseMode === 'hybrid',
            maxRows: this.config.mechanics.board.rows,

            // Level progression
            disableLevelProgression: !this.config.mechanics.speed.levelProgression,

            // Initial state
            initialLevel: this.config.mechanics.speed.startLevel,
            fixedDropInterval: this.config.mechanics.speed.fixedDropInterval,
        };

        return new GameState(options);
    }

    /**
     * Builds physics callbacks with level-specific modifications
     */
    buildPhysicsCallbacks(baseCallbacks) {
        const modifiedCallbacks = { ...baseCallbacks };

        // Apply modifiers
        for (const modifier of this.modifierStack.getActive()) {
            modifier.applyToCallbacks(modifiedCallbacks);
        }

        // Wrap line clear to check victory conditions
        const originalOnLineClear = modifiedCallbacks.onLineClear;
        modifiedCallbacks.onLineClear = (lineCount) => {
            originalOnLineClear(lineCount);
            this.victoryEvaluator.onLineClear(lineCount);
        };

        return modifiedCallbacks;
    }

    /**
     * Check if level is complete
     */
    checkVictory(gameState) {
        return this.victoryEvaluator.evaluate(gameState, this.config.victory);
    }

    /**
     * Check if level failed
     */
    checkFailure(gameState) {
        return this.victoryEvaluator.evaluateFailure(gameState, this.config.victory);
    }

    /**
     * Calculate star rating based on performance
     */
    calculateStars(results) {
        const starConfig = this.config.stars;

        let stars = 0;

        if (this.meetsCondition(results, starConfig.one)) stars = 1;
        if (this.meetsCondition(results, starConfig.two)) stars = 2;
        if (this.meetsCondition(results, starConfig.three)) stars = 3;

        return stars;
    }
}
```

### 6.2 MechanicsMixer

**Location**: `src/core/journey/MechanicsMixer.js`

```javascript
export class MechanicsMixer {
    constructor() {
        this.baseRules = null;
        this.overrides = new Map();
    }

    /**
     * Set base mechanics from a mode
     */
    setBaseMode(mode) {
        switch (mode) {
            case 'standard':
                this.baseRules = {
                    gravity: 'instant', // Blocks fall instantly after clear
                    cascades: false,
                    levelProgression: true,
                    scoring: 'standard',
                };
                break;

            case 'infinity':
                this.baseRules = {
                    gravity: 'cascading', // Blocks fall one row at a time
                    cascades: true,
                    levelProgression: false,
                    scoring: 'combo-focused',
                };
                break;

            case 'hybrid':
                this.baseRules = {
                    gravity: 'cascading',
                    cascades: true,
                    levelProgression: true,
                    scoring: 'hybrid',
                };
                break;
        }
    }

    /**
     * Override specific mechanics
     */
    override(mechanic, value) {
        this.overrides.set(mechanic, value);
    }

    /**
     * Get final mechanic value
     */
    get(mechanic) {
        if (this.overrides.has(mechanic)) {
            return this.overrides.get(mechanic);
        }
        return this.baseRules[mechanic];
    }

    /**
     * Check if cascading gravity is enabled
     */
    hasCascadingGravity() {
        return this.get('gravity') === 'cascading';
    }
}
```

### 6.3 ModifierStack

**Location**: `src/core/journey/ModifierStack.js`

```javascript
/**
 * Available modifiers that can be applied to levels
 */
export const MODIFIER_DEFINITIONS = {
    'gravity-cascade': {
        name: 'Gravity Cascade',
        description: 'Blocks fall one row at a time, enabling cascading clears',
        apply: (gameState) => {
            gameState.enableCascadingGravity = true;
        },
        applyToCallbacks: (callbacks) => {
            // Already handled by physics.js when enableCascadingGravity is true
        },
    },

    'time-attack': {
        name: 'Time Attack',
        description: 'Race against the clock',
        apply: (gameState) => {
            gameState.timeLimit = true;
        },
        applyToCallbacks: (callbacks) => {
            // Timer UI handled separately
        },
    },

    'combo-multiplier': {
        name: 'Combo Multiplier',
        description: 'Score multiplier increases with each consecutive clear',
        apply: (gameState) => {
            gameState.comboMultiplierEnabled = true;
        },
        applyToCallbacks: (callbacks) => {
            const originalOnLineClear = callbacks.onLineClear;
            callbacks.onLineClear = (lineCount) => {
                // Apply combo multiplier to score
                originalOnLineClear(lineCount);
            };
        },
    },

    'invisible': {
        name: 'Invisible',
        description: 'Placed blocks become invisible after a moment',
        apply: (gameState) => {
            gameState.invisibleBlocks = true;
        },
        applyToCallbacks: (callbacks) => {
            const originalOnPieceLock = callbacks.onPieceLock;
            callbacks.onPieceLock = (piece) => {
                originalOnPieceLock(piece);
                // Fade out blocks after delay
                setTimeout(() => {
                    piece.cells.forEach(cell => cell.opacity = 0.1);
                }, 1000);
            };
        },
    },

    'mirror': {
        name: 'Mirror Mode',
        description: 'Controls are horizontally reversed',
        apply: (gameState) => {
            gameState.mirrorControls = true;
        },
        applyToCallbacks: (callbacks) => {
            const originalOnMove = callbacks.onMove;
            callbacks.onMove = (direction) => {
                originalOnMove(-direction); // Reverse direction
            };
        },
    },

    'big-blocks': {
        name: 'Big Blocks',
        description: 'Pieces are 2x2 instead of standard size',
        apply: (gameState) => {
            gameState.bigBlockMode = true;
        },
        applyToCallbacks: (callbacks) => {
            // Piece generation handled by custom piece generator
        },
    },
};

export class ModifierStack {
    constructor() {
        this.activeModifiers = [];
    }

    activate(modifierIds) {
        this.activeModifiers = modifierIds
            .map(id => MODIFIER_DEFINITIONS[id])
            .filter(Boolean);
    }

    getActive() {
        return this.activeModifiers;
    }

    applyAll(gameState) {
        for (const modifier of this.activeModifiers) {
            modifier.apply(gameState);
        }
    }
}
```

### 6.4 VictoryConditionEvaluator

**Location**: `src/core/journey/VictoryConditionEvaluator.js`

```javascript
export class VictoryConditionEvaluator {
    constructor() {
        this.trackedMetrics = {
            lines: 0,
            score: 0,
            time: 0,
            cascades: 0,
            maxCascadeDepth: 0,
            combos: 0,
            tetrises: 0,
            singles: 0,
            height: 0,
        };
    }

    reset() {
        Object.keys(this.trackedMetrics).forEach(key => {
            this.trackedMetrics[key] = 0;
        });
    }

    onLineClear(lineCount) {
        this.trackedMetrics.lines += lineCount;

        if (lineCount === 1) this.trackedMetrics.singles++;
        if (lineCount === 4) this.trackedMetrics.tetrises++;
    }

    onCascade(cascadeDepth) {
        this.trackedMetrics.cascades++;
        this.trackedMetrics.maxCascadeDepth = Math.max(
            this.trackedMetrics.maxCascadeDepth,
            cascadeDepth
        );
    }

    onCombo(comboCount) {
        this.trackedMetrics.combos = Math.max(this.trackedMetrics.combos, comboCount);
    }

    updateTime(elapsed) {
        this.trackedMetrics.time = elapsed;
    }

    updateHeight(height) {
        this.trackedMetrics.height = Math.max(this.trackedMetrics.height, height);
    }

    evaluate(gameState, victoryConfig) {
        const condition = victoryConfig.primary;

        switch (condition.type) {
            case 'lines':
                return this.trackedMetrics.lines >= condition.target;

            case 'score':
                return gameState.score >= condition.target;

            case 'time':
                return this.trackedMetrics.time >= condition.target;

            case 'cascade':
                return this.trackedMetrics.cascades >= condition.target;

            case 'height':
                return this.trackedMetrics.height >= condition.target;

            case 'custom':
                return condition.evaluator(this.trackedMetrics, gameState);

            default:
                console.warn(`Unknown victory condition: ${condition.type}`);
                return false;
        }
    }

    evaluateFailure(gameState, victoryConfig) {
        const failure = victoryConfig.failure;

        switch (failure.type) {
            case 'top-out':
                return gameState.isGameOver;

            case 'time':
                return this.trackedMetrics.time >= failure.value;

            case 'none':
                return false;

            default:
                return false;
        }
    }

    evaluateBonuses(bonuses) {
        return bonuses.map(bonus => {
            switch (bonus.type) {
                case 'no-singles':
                    return this.trackedMetrics.singles === 0;

                case 'time':
                    return this.trackedMetrics.time <= bonus.target;

                case 'max-cascade-depth':
                    return this.trackedMetrics.maxCascadeDepth >= bonus.target;

                case 'tetris-count':
                    return this.trackedMetrics.tetrises >= bonus.target;

                default:
                    return false;
            }
        });
    }
}
```

---

## 7. Theme Integration

### 7.1 ThemeTransitionManager

**Location**: `src/core/journey/ThemeTransitionManager.js`

Handles smooth transitions between visual themes during gameplay.

```javascript
export class ThemeTransitionManager {
    constructor(themeManager) {
        this.themeManager = themeManager;
        this.activeTheme = null;
        this.overlays = [];
        this.transitionQueue = [];
        this.isTransitioning = false;
    }

    /**
     * Set up theme for a level
     */
    async setupLevel(themeConfig) {
        const { primary, overlays, transitionIn, transitionDuration } = themeConfig;

        // Load primary theme
        await this.themeManager.loadTheme(primary, true);

        // Preload overlay themes
        for (const overlay of overlays) {
            await this.themeManager.loadTheme(overlay, true);
        }

        // Execute transition
        await this.transition(primary, transitionIn, transitionDuration);

        // Apply overlays
        this.applyOverlays(overlays);
    }

    /**
     * Transition to a new theme
     */
    async transition(themeName, transitionType, duration) {
        if (this.isTransitioning) {
            this.transitionQueue.push({ themeName, transitionType, duration });
            return;
        }

        this.isTransitioning = true;

        switch (transitionType) {
            case 'fade':
                await this.fadeTransition(themeName, duration);
                break;

            case 'crossfade':
                await this.crossfadeTransition(themeName, duration);
                break;

            case 'warp':
                await this.warpTransition(themeName, duration);
                break;

            default:
                await this.themeManager.switchTheme(themeName);
        }

        this.isTransitioning = false;

        // Process queue
        if (this.transitionQueue.length > 0) {
            const next = this.transitionQueue.shift();
            await this.transition(next.themeName, next.transitionType, next.duration);
        }
    }

    async fadeTransition(themeName, duration) {
        const overlay = document.getElementById('theme-transition-overlay');

        // Fade to black
        overlay.style.transition = `opacity ${duration / 2}ms`;
        overlay.style.opacity = '1';

        await this.wait(duration / 2);

        // Switch theme while blacked out
        await this.themeManager.switchTheme(themeName, true);

        // Fade from black
        overlay.style.opacity = '0';

        await this.wait(duration / 2);
    }

    async crossfadeTransition(themeName, duration) {
        // Create temporary canvas for old theme
        const oldCanvas = this.captureCurrentTheme();

        // Switch theme
        await this.themeManager.switchTheme(themeName, true);

        // Crossfade old canvas over new
        oldCanvas.style.transition = `opacity ${duration}ms`;
        oldCanvas.style.opacity = '0';

        await this.wait(duration);

        oldCanvas.remove();
    }

    async warpTransition(themeName, duration) {
        // Add warping shader effect
        const warpEffect = this.createWarpEffect();

        await warpEffect.animate(duration / 2);

        await this.themeManager.switchTheme(themeName, true);

        await warpEffect.reverseAnimate(duration / 2);

        warpEffect.dispose();
    }

    /**
     * Apply overlay themes (blended on top of primary)
     */
    applyOverlays(overlayNames) {
        // Clear existing overlays
        this.overlays.forEach(o => o.dispose?.());
        this.overlays = [];

        for (const overlayName of overlayNames) {
            const overlay = this.createOverlayInstance(overlayName);
            this.overlays.push(overlay);
        }
    }

    wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
```

### 7.2 Theme Blending Shaders

**Location**: `src/rendering/journey/shaders/theme-blend.frag`

```glsl
precision highp float;

uniform sampler2D uPrimaryTheme;
uniform sampler2D uOverlayTheme;
uniform float uBlendAmount;
uniform int uBlendMode; // 0=normal, 1=additive, 2=multiply, 3=screen

varying vec2 vUv;

vec3 blendNormal(vec3 base, vec3 blend, float opacity) {
    return mix(base, blend, opacity);
}

vec3 blendAdditive(vec3 base, vec3 blend, float opacity) {
    return base + blend * opacity;
}

vec3 blendMultiply(vec3 base, vec3 blend, float opacity) {
    return mix(base, base * blend, opacity);
}

vec3 blendScreen(vec3 base, vec3 blend, float opacity) {
    return mix(base, 1.0 - (1.0 - base) * (1.0 - blend), opacity);
}

void main() {
    vec4 primary = texture2D(uPrimaryTheme, vUv);
    vec4 overlay = texture2D(uOverlayTheme, vUv);

    vec3 result;

    if (uBlendMode == 0) {
        result = blendNormal(primary.rgb, overlay.rgb, uBlendAmount * overlay.a);
    } else if (uBlendMode == 1) {
        result = blendAdditive(primary.rgb, overlay.rgb, uBlendAmount * overlay.a);
    } else if (uBlendMode == 2) {
        result = blendMultiply(primary.rgb, overlay.rgb, uBlendAmount * overlay.a);
    } else {
        result = blendScreen(primary.rgb, overlay.rgb, uBlendAmount * overlay.a);
    }

    gl_FragColor = vec4(result, 1.0);
}
```

---

## 8. Data Schema & Configuration

### 8.1 Complete Level Schema (TypeScript Definition)

```typescript
// src/core/journey/types/LevelConfig.ts

interface BoardConfig {
    columns: number;           // 10 default
    rows: number;              // 20-1000
    startingRows: number;      // Pre-filled rows
    startingPattern?: string;  // Pattern name for pre-fill
}

interface SpeedConfig {
    startLevel: number;        // 1-40
    levelProgression: boolean; // Speed increases with lines
    fixedDropInterval: number | null; // Override (ms)
}

interface PieceConfig {
    bagType: '7-bag' | 'random' | 'custom';
    customSequence?: string[]; // For puzzle levels
    holdEnabled: boolean;
    previewCount: number;      // 1-7
}

interface MechanicsConfig {
    baseMode: 'standard' | 'infinity' | 'hybrid';
    board: BoardConfig;
    speed: SpeedConfig;
    pieces: PieceConfig;
}

interface VictoryCondition {
    type: 'lines' | 'score' | 'time' | 'height' | 'cascade' | 'combo' | 'custom';
    target: number;
    evaluator?: (metrics: Metrics, state: GameState) => boolean;
}

interface FailureCondition {
    type: 'top-out' | 'time' | 'none';
    value?: number;
}

interface BonusObjective {
    type: string;
    target?: number;
    description: string;
}

interface VictoryConfig {
    primary: VictoryCondition;
    failure: FailureCondition;
    bonuses: BonusObjective[];
}

interface StarThreshold {
    [key: string]: number | boolean;
}

interface StarConfig {
    one: StarThreshold;
    two: StarThreshold;
    three: StarThreshold;
}

interface ThemeConfig {
    primary: string;           // Theme ID
    overlays: string[];        // Overlay theme IDs
    transitionIn: 'fade' | 'crossfade' | 'warp' | 'none';
    transitionDuration: number; // ms
}

interface LevelMetadata {
    description: string;
    difficulty: number;        // 1-10
    estimatedTime: number;     // seconds
    tip?: string;
}

interface LevelConfig {
    id: number;
    name: string;
    chapter: number;
    chapterLevel: number;
    isChapterStart: boolean;
    isChapterEnd: boolean;
    pathPosition: number;      // 0-1

    theme: ThemeConfig;
    mechanics: MechanicsConfig;
    victory: VictoryConfig;
    modifiers: { active: string[] };
    stars: StarConfig;
    metadata: LevelMetadata;
}
```

### 8.2 Save Data Schema

```javascript
// src/core/journey/data/save-schema.js

export const SAVE_SCHEMA = {
    version: 1,

    structure: {
        journeyProgress: {
            currentChapter: 'number',
            currentLevel: 'number',
            unlockedLevels: 'number[]',
            completedLevels: {
                // levelId → completion data
                type: 'object',
                value: {
                    stars: 'number',
                    bestScore: 'number',
                    bestTime: 'number',
                    completedBonuses: 'boolean[]',
                    completionDate: 'string',
                }
            },
        },

        statistics: {
            totalPlayTime: 'number',
            totalLinesCleared: 'number',
            totalScore: 'number',
            highestCombo: 'number',
            maxCascadeDepth: 'number',
            chaptersCompleted: 'number',
            totalStars: 'number',
            attemptsPerLevel: 'object', // levelId → attempt count
        },

        settings: {
            // Journey-specific settings
            autoAdvance: 'boolean', // Auto-move to next level on complete
            showHints: 'boolean',
            cinematicsEnabled: 'boolean',
        },

        metadata: {
            lastSaveDate: 'string',
            playCount: 'number',
        },
    },
};
```

---

## 9. Implementation Phases

### Phase 1: Foundation (Week 1-2)

**Goal**: Core architecture and basic Odyssey Mode shell

**Tasks**:
1. Create `OdysseyMode` class extending `BaseGameMode`
2. Implement `OdysseyStateManager` with save/load
3. Create `LevelRegistry` with first 5 test levels
4. Add `GAME_MODES.ODYSSEY` constant
5. Register mode in `GameModeManager`
6. Basic level selection UI (placeholder)

**Deliverables**:
- [ ] Can launch Odyssey Mode from menu
- [ ] Can load a level configuration
- [ ] Progress saves to localStorage
- [ ] Basic level completion flow

### Phase 2: Gameplay Hybrid System (Week 2-3)

**Goal**: Level mechanics mixing system

**Tasks**:
1. Implement `GameplayHybridEngine`
2. Create `MechanicsMixer` for base mode selection
3. Build `VictoryConditionEvaluator`
4. Implement `ModifierStack` with 5 core modifiers
5. Connect to existing `GameState` and physics system
6. Add level-specific UI elements (timer, objectives)

**Deliverables**:
- [ ] Levels can use Standard or Infinity mechanics
- [ ] Victory conditions work (lines, score, cascade, time)
- [ ] Star ratings calculate correctly
- [ ] At least 5 modifiers functional

### Phase 3: Three.js Journey Board (Week 3-5)

**Goal**: 3D world navigation

**Tasks**:
1. Create `OdysseyBoardController` with Three.js scene
2. Implement `OdysseyPathRenderer` (spline path)
3. Build `LevelNodeManager` (level markers)
4. Create `OdysseyCameraController` (navigation)
5. Implement `EnvironmentManager` (chapter backdrops)
6. Add mouse/touch/gamepad navigation
7. Level preview on hover/selection

**Deliverables**:
- [ ] 3D world renders with path and nodes
- [ ] Camera follows path smoothly
- [ ] Can navigate and select levels
- [ ] Chapter environments change
- [ ] Quality settings affect rendering

### Phase 4: Theme Transitions (Week 5-6)

**Goal**: Smooth visual theme flow

**Tasks**:
1. Implement `ThemeTransitionManager`
2. Create fade, crossfade, warp transitions
3. Build overlay blending system
4. Connect to existing `ThemeManager`
5. Level-to-board transition animations
6. Chapter intro cinematics (optional)

**Deliverables**:
- [ ] Themes transition smoothly between levels
- [ ] Overlays blend correctly
- [ ] No jarring visual cuts
- [ ] Transitions respect quality settings

### Phase 5: Content Creation (Week 6-8)

**Goal**: Full 56 levels configured

**Tasks**:
1. Design all 56 level configurations
2. Balance difficulty curve
3. Configure all chapter themes
4. Add music track assignments
5. Write level descriptions and tips
6. Test and tune star thresholds

**Deliverables**:
- [ ] All 56 levels playable
- [ ] Difficulty curve feels right
- [ ] Star ratings achievable but challenging
- [ ] All themes integrated

### Phase 6: Polish & UI (Week 8-9)

**Goal**: Complete user experience

**Tasks**:
1. Odyssey Mode menu design
2. Level select UI refinement
3. Progress display (stars, completion)
4. Results screen with stats
5. Achievement integration (optional)
6. Accessibility options
7. Performance optimization pass

**Deliverables**:
- [ ] Complete UI flow
- [ ] Stats and progress visible
- [ ] Smooth 60fps on target hardware
- [ ] Keyboard/gamepad full support

### Phase 7: Testing & Release (Week 9-10)

**Goal**: Production ready

**Tasks**:
1. Full playthrough testing
2. Edge case handling
3. Save corruption prevention
4. Memory leak testing
5. Cross-browser testing
6. Documentation

**Deliverables**:
- [ ] No critical bugs
- [ ] Performance targets met
- [ ] Documentation complete

---

## 10. File Structure

```
src/
├── core/
│   ├── game-modes/
│   │   ├── OdysseyMode.js          # Main mode class
│   │   └── index.js                # Export OdysseyMode
│   │
│   └── journey/
│       ├── OdysseyStateManager.js  # Progress tracking
│       ├── LevelRegistry.js        # Level data access
│       ├── GameplayHybridEngine.js # Mechanics mixing
│       ├── MechanicsMixer.js       # Mode rule mixing
│       ├── VictoryConditionEvaluator.js
│       ├── ModifierStack.js        # Level modifiers
│       ├── ThemeTransitionManager.js
│       │
│       ├── data/
│       │   ├── levels.js           # All 56 level configs
│       │   ├── chapters.js         # Chapter metadata
│       │   ├── modifiers.js        # Modifier definitions
│       │   ├── path.js             # 3D path control points
│       │   └── save-schema.js      # Save data structure
│       │
│       └── types/
│           └── LevelConfig.ts      # TypeScript definitions
│
├── rendering/
│   └── journey/
│       ├── OdysseyBoardController.js
│       ├── OdysseyPathRenderer.js
│       ├── LevelNodeManager.js
│       ├── EnvironmentManager.js
│       ├── OdysseyCameraController.js
│       │
│       └── shaders/
│           ├── path.vert
│           ├── path.frag
│           ├── node.vert
│           ├── node.frag
│           ├── environment.vert
│           ├── environment.frag
│           └── theme-blend.frag
│
├── ui/
│   └── journey/
│       ├── JourneyMenu.js          # Main menu integration
│       ├── LevelSelectUI.js        # Level selection overlay
│       ├── LevelPreviewPanel.js    # Level info popup
│       ├── OdysseyHUD.js           # In-game UI
│       ├── LevelResultsModal.js    # Completion screen
│       └── ChapterIntroOverlay.js  # Chapter start cinematics
│
└── assets/
    └── journey/
        ├── icons/                   # Chapter icons
        ├── textures/               # Path textures
        └── audio/                  # Journey-specific sounds
```

---

## 11. API Reference

### OdysseyMode Public API

```javascript
// Mode lifecycle (inherited from BaseGameMode)
journeyMode.onActivate()
journeyMode.onStart()
journeyMode.onPause()
journeyMode.onResume()
journeyMode.onStop()
journeyMode.onDeactivate()

// Journey-specific methods
journeyMode.enterLevel(levelId: number): Promise<void>
journeyMode.completeLevel(results: LevelResults): Promise<void>
journeyMode.returnToBoard(): Promise<void>
journeyMode.navigateToChapter(chapterId: number): void
journeyMode.selectNode(levelId: number): void
journeyMode.getProgress(): JourneyProgress
journeyMode.resetProgress(): void
```

### OdysseyBoardController Public API

```javascript
// Initialization
boardController.initialize(): Promise<void>
boardController.dispose(): void

// Navigation
boardController.panToChapter(chapterId: number, duration?: number): void
boardController.focusOnNode(levelId: number): void
boardController.setFreeRoam(enabled: boolean): void

// State
boardController.setProgress(normalizedPosition: number): void
boardController.highlightNode(levelId: number): void
boardController.updateNodeState(levelId: number, state: NodeState): void

// Rendering
boardController.setQuality(quality: 'low' | 'medium' | 'high' | 'ultra'): void
boardController.resize(width: number, height: number): void
```

### GameplayHybridEngine Public API

```javascript
// Setup
engine.createGameState(): GameState
engine.buildPhysicsCallbacks(baseCallbacks: Object): Object
engine.getModifiers(): Modifier[]

// Evaluation
engine.checkVictory(gameState: GameState): boolean
engine.checkFailure(gameState: GameState): boolean
engine.calculateStars(results: LevelResults): number
engine.getBonusResults(): boolean[]
```

### Events Emitted

```javascript
// Journey-specific events (via eventBus)
EVENTS.JOURNEY_LEVEL_START = 'journeyLevelStart'
EVENTS.JOURNEY_LEVEL_COMPLETE = 'journeyLevelComplete'
EVENTS.JOURNEY_LEVEL_FAIL = 'journeyLevelFail'
EVENTS.JOURNEY_CHAPTER_UNLOCK = 'journeyChapterUnlock'
EVENTS.JOURNEY_STAR_EARNED = 'journeyStarEarned'
EVENTS.JOURNEY_BOARD_NAVIGATE = 'journeyBoardNavigate'
```

---

## 12. Performance Considerations

### Memory Management

1. **Theme Caching**: Reuse existing `ThemeManager` LRU cache (5 themes max)
2. **Level Data**: Lazy-load chapter data, not all 56 levels at once
3. **3D Assets**: LOD system for distant nodes, dispose unused geometries
4. **Textures**: Compressed textures, resolution based on quality setting

### Rendering Optimization

1. **Journey Board**:
   - Use instancing for level nodes (InstancedMesh)
   - Frustum culling for off-screen elements
   - LOD for path detail (high near camera, low far)
   - 30fps render when paused/idle

2. **Gameplay**:
   - Reuse existing optimizations from SinglePlayer/Infinity modes
   - Throttle stats updates (250ms intervals)
   - Object pooling for particles

### Quality Presets

```javascript
const JOURNEY_QUALITY_PRESETS = {
    low: {
        pathSegments: 100,
        nodeDetail: 1,
        particleCount: 50,
        shadowsEnabled: false,
        postProcessing: false,
    },
    medium: {
        pathSegments: 200,
        nodeDetail: 2,
        particleCount: 100,
        shadowsEnabled: false,
        postProcessing: true,
    },
    high: {
        pathSegments: 400,
        nodeDetail: 3,
        particleCount: 200,
        shadowsEnabled: true,
        postProcessing: true,
    },
    ultra: {
        pathSegments: 800,
        nodeDetail: 4,
        particleCount: 500,
        shadowsEnabled: true,
        postProcessing: true,
    },
};
```

---

## 13. Future Extensibility

### Adding New Levels

1. Add entry to `src/core/journey/data/levels.js`
2. Assign to chapter and set `pathPosition`
3. Configure mechanics, victory conditions, modifiers
4. Run game - level automatically appears in registry

### Adding New Modifiers

1. Add definition to `MODIFIER_DEFINITIONS` in `ModifierStack.js`
2. Implement `apply()` function for game state changes
3. Implement `applyToCallbacks()` for physics modifications
4. Reference by ID in level configs

### Adding New Victory Conditions

1. Add case to `VictoryConditionEvaluator.evaluate()`
2. Add tracking in `trackedMetrics` if needed
3. Update `onLineClear()` or add new hook for tracking
4. Use in level configs

### Adding New Themes

1. Create theme following existing pattern
2. Add to `THEME_REGISTRY`
3. Reference by ID in level/chapter configs
4. Theme automatically available

### Modding Support (Future)

The data-driven design enables future modding:
- Custom level packs as JSON files
- User-created chapters
- Community challenges
- Level editor integration

---

## Conclusion

This implementation plan provides a comprehensive roadmap for building Odyssey Mode. The modular, data-driven architecture ensures:

1. **Easy Modification**: Level parameters in simple config objects
2. **Flexible Mechanics**: Mix and match gameplay rules per level
3. **Visual Excellence**: Three.js world with smooth theme transitions
4. **Maintainability**: Clear separation of concerns
5. **Performance**: Leverages existing optimizations

The phased approach allows incremental development with testable milestones. Each phase delivers a functional subset of features, enabling early testing and iteration.

---

*Document generated by Claude Code*
*For questions or clarifications, refer to the codebase exploration notes*
