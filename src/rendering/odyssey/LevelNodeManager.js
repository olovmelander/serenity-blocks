/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview LevelNodeManager - Manages level node orbs along the path
 *
 * Creates interactive 3D representations for each level,
 * showing state (locked/unlocked/completed) and stars.
 *
 * WebGPU: this is the live manager. Its node materials are TSL NodeMaterials built by
 * the validated sibling builders in ./level-node-manager.tsl.js (glass shell / glow
 * halo / billboarded sparkle particles / fluid inner core) so they render on
 * THREE.WebGPURenderer. The class API (createNodes/update/updateFromProgress/setCamera/
 * setAAAVisualsEnabled/updateLayout/setPathEvaluator/setCameraProgress + node hit-
 * testing) is unchanged.
 */

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { THEME_REGISTRY } from '../../themes/theme-registry.js';
import { buildThemeIconLookup, resolveThemeIconAssetUrl } from './theme-icon-resolver.js';
import {
    ODYSSEY_NODE_STYLES,
    getChapterProfile,
} from './chapter-environments/shared/chapter-profile.js';
import { getActiveOdysseyChapterPositions } from './path-utils.js';
import {
    createGlassShellTSL,
    createGlowHaloTSL,
    createNodeParticlesTSL,
    createNodeParticleGeometry,
    createFluidInnerTSL,
    createFluidInnerInstancedTSL,
} from './level-node-manager.tsl.js';

const THEME_ICON_MODULES = import.meta.glob('../../themes/*/*-theme-icon.{png,svg}', {
    import: 'default',
});
const THEME_ICON_LOOKUP = buildThemeIconLookup(THEME_REGISTRY, THEME_ICON_MODULES);

/**
 * LEVER 1 (core texture-atlas instancing) escape hatch. DEFAULT OFF — this is a
 * capture-gated WebGPU change (visual identity of all 55 inner cores cannot be verified
 * headless), so it ships inert and is opt-in via `?odysseyCoreInstanced=1` until a
 * playground + in-game capture confirms the instanced cores are pixel-identical, after
 * which the default can be flipped. When OFF, createGlassNode builds the legacy per-node
 * inner-core Mesh exactly as before (55 materials / 55 pipeline compiles).
 */
function readOdysseyCoreInstancedFlag() {
    if (typeof window === 'undefined') return false;
    try {
        const raw = new URLSearchParams(window.location?.search || '').get('odysseyCoreInstanced');
        if (raw === '1' || raw === 'true' || raw === 'on') return true;
    } catch { /* default off */ }
    return false;
}

// P3b: map each per-world node shell style to a shader style index.
export const ODYSSEY_NODE_SHELL_STYLE_INDEX = Object.freeze({
    [ODYSSEY_NODE_STYLES.MAGMA_GEODE]: 0,
    [ODYSSEY_NODE_STYLES.BUBBLE_PEARL]: 1,
    [ODYSSEY_NODE_STYLES.SEED_LANTERN]: 2,
    [ODYSSEY_NODE_STYLES.CAIRN_LANTERN]: 3,
    [ODYSSEY_NODE_STYLES.CLOUD_WISP]: 4,
    [ODYSSEY_NODE_STYLES.STARLIT_ORB]: 5,
    [ODYSSEY_NODE_STYLES.LENSED_SHARD]: 6,
    [ODYSSEY_NODE_STYLES.NEON_SIGN]: 7,
});

export function resolveOdysseyNodeShellStyle(chapter, levelId = 1) {
    const profile = getChapterProfile(chapter);
    const style = profile.node?.style || ODYSSEY_NODE_STYLES.MAGMA_GEODE;
    const baseColor = profile.palette?.primary ?? 0xffffff;
    const accentColor = profile.palette?.accent ?? baseColor;
    const seed = (((profile.id || 1) * 97) + ((levelId || 1) * 37)) % 997;

    return {
        style,
        index: ODYSSEY_NODE_SHELL_STYLE_INDEX[style] ?? 0,
        baseColor,
        accentColor,
        seed: seed / 997,
    };
}
const GLASS_ORB_SCALE = 1.4; // Slightly larger for better visibility and premium feel
const GLASS_INNER_RADIUS = 0.95 * GLASS_ORB_SCALE;
const GLASS_OUTER_RADIUS = 1.0 * GLASS_ORB_SCALE;
const GLASS_GLOW_RADIUS = 1.12 * GLASS_ORB_SCALE;
// Snow-globe: render the themed inner core at a fraction of the shell radius so it reads as
// an object SUSPENDED inside the clear glass globe (glass-rim gap + orbiting sparkle "snow"),
// instead of a magma ball that fills the shell and makes the transparent glass look solid.
// Kept large enough (radius ≈0.70) to still cover the path line passing ≈0.45 behind centre.
const INNER_CORE_DISPLAY_SCALE = 0.66;
const CHAPTER_NODE_BASE_SCALE = Object.freeze({
    1: 1.0,
});
// Inner-fluid flow/wobble strengths now live in the TSL builder (createFluidInnerTSL).
const UPDATE_PROXIMITY_THRESHOLD = 0.15; // Only fully update nodes within this path-distance of the camera
const NODE_PATH_SURFACE_OFFSET_Z = 1.8; // Increased from 0.45 so level nodes float clearly outside the spline path (radius 0.6)
const CHAPTER_1_NODE_QUENCH_START = 0.58;
const CHAPTER_1_NODE_QUENCH_END = 0.74;
const CHAPTER_1_NODE_MIN_SCALE = 0.0;
// QW11: below this per-frame camera-progress delta the instanced/particle GPU buffers
// are treated as unchanged, so update() skips the ~7040-particle + instance re-upload
// (the time-driven sparkle/iridescence still animates in-shader via uTime). Small enough
// that any real camera dolly re-flushes immediately, but 1e-4 (not 1e-5) so sub-pixel
// idle camera sway/breathing doesn't needlessly re-flush the whole particle buffer.
const UPDATE_PROGRESS_EPSILON = 1e-4;

// Lock/star indicator placement relative to the orb, expressed in the CAMERA basis
// (camera-right, camera-up, toward-camera) and multiplied by node scale. Placing them in
// screen space — instead of a fixed world offset — keeps them directly above the orb and
// facing the camera at every chapter's wildly different camera angle. `toward` pushes them
// in FRONT of the orb's opaque core (radius ~1.06×scale) so the core never occludes them,
// while still leaving depth-test on so a far level's indicator can't bleed over a nearer orb.
// Applied each frame in _updateIndicatorBillboards().
const LOCK_PLACEMENT = Object.freeze({ up: 1.5, toward: 1.0 });
const STAR_PLACEMENT = Object.freeze([
    Object.freeze({ right: -0.6, up: 1.5, toward: 0.9 }),
    Object.freeze({ right: 0.0, up: 1.72, toward: 0.95 }),
    Object.freeze({ right: 0.6, up: 1.5, toward: 0.9 }),
]);

/**
 * LevelNodeManager - Manages level selection orbs
 */
export class LevelNodeManager {
    constructor(scene, pathCurve) {
        this.scene = scene;
        this.pathCurve = pathCurve;
        this.nodes = new Map(); // levelId → NodeObject
        this.selectedNode = null;
        this.hoveredNode = null;
        this.time = 0;
        this.frameCount = 0;
        this.cameraProgress = 0;
        this.textureLoader = new THREE.TextureLoader();
        this.themeTextureCache = new Map(); // iconUrl -> THREE.Texture
        this.themeTextureLoads = new Map(); // iconUrl -> Promise<THREE.Texture|null>
        this.cachedBasePositions = new Map(); // levelId -> THREE.Vector3

        // Shared geometries (reused across all 55 nodes). Segment counts trimmed (48→32
        // glass, 32→24 inner) — these render on all 55 orbs EVERY frame in EVERY chapter, so
        // the tri saving is the highest-leverage always-present win; a small refractive orb
        // reads identically at gameplay distance.
        this.sharedInnerGeo = new THREE.SphereGeometry(GLASS_INNER_RADIUS, 24, 24);
        this.sharedGlassGeo = new THREE.SphereGeometry(GLASS_OUTER_RADIUS, 32, 32);
        this.sharedGlowGeo = new THREE.IcosahedronGeometry(GLASS_GLOW_RADIUS, 2);

        // Shared canvas textures (identical across all nodes)
        this.fallbackIconTexture = this.createFallbackIconTexture();
        this.sharedLockTextures = this._createSharedLockTextures();
        this.sharedStarTexture = this.createStarTexture(128);
        this.sharedGlowTexture = this.createGlowTexture(64);

        this.pathEvaluator = null;

        // Instanced Mesh state
        this.instanceCount = 0;
        this.glassInstancedMesh = null;
        this.glowInstancedMesh = null;
        this.lockInstancedMesh = null;
        this.starInstancedMesh = null;
        this.particleSystem = null;
        this.instanceIdMap = new Map(); // levelId -> instanceIndex
        this.nodeIds = []; // index -> levelId
        this.camera = null;

        // LEVER 1: instanced inner-core state (default OFF; see readOdysseyCoreInstancedFlag).
        // When ON, all 55 inner fluid cores collapse to ONE InstancedMesh + ONE material +
        // ONE pipeline + a shared DataArrayTexture of theme icons (per-instance layer index).
        this.coreInstanced = readOdysseyCoreInstancedFlag();
        this.innerCoreMesh = null;
        this.innerCoreMaterial = null;
        this.coreArrayTexture = null;
        this.coreAtlasSize = 256;
        this.iconUrlToLayer = new Map(); // resolved iconUrl -> layer index (>=1)
        this.levelLayer = new Map(); // levelId -> layer index (-1 = no icon → procedural magma)
        this._scratchMatrix2 = new THREE.Matrix4();
        this._scratchInnerScaleVec = new THREE.Vector3();

        // P3 focal hierarchy (AAA): the player's current/next node blazes + beat-pulses.
        this.focalHierarchy = false;
        this.worldShellsEnabled = false;
        this.currentLevelId = 1;
        this._beatPulse = 0;

        // QW11 (perf): reused per-frame scratch so update() allocates nothing per node.
        // The matrix, the scale vec, the camera-basis vectors used to place the lock/star
        // indicators in screen space, and a white fallback Color are all hoisted here and
        // .copy()'d into rather than re-`new`d / `.clone()`d each of the ~55 nodes/frame.
        this._scratchMatrix = new THREE.Matrix4();
        this._scratchScaleVec = new THREE.Vector3();
        // Camera-basis scratch for placing the lock/star indicators in screen space every
        // frame (always above the orb, facing & slightly toward the camera). See
        // _updateIndicatorBillboards() + LOCK_PLACEMENT / STAR_PLACEMENT.
        this._scratchCamRight = new THREE.Vector3();
        this._scratchCamUp = new THREE.Vector3();
        this._scratchCamPos = new THREE.Vector3();
        this._scratchToCam = new THREE.Vector3();
        this._scratchIndicatorPos = new THREE.Vector3();
        // Camera world matrix at the last indicator placement — lets the per-frame pass skip
        // its (cheap) re-upload when the board is fully settled (no camera movement at all).
        this._lastIndicatorCamMatrix = new THREE.Matrix4();
        this._fallbackColor = new THREE.Color(0xffffff);

        // QW11 (perf): gate the ~7040-particle + 4-instanced-attribute GPU re-upload so
        // it only happens when something the buffers depend on actually changed (camera
        // progress / visibility / hover / select / state / layout), not every frame.
        // Bumping _uploadDirty marks the next update() to flush needsUpdate; otherwise
        // the time-driven sparkle/iridescence keeps animating purely in the shader (uTime
        // is still ticked every frame) with no per-frame CPU loop + GPU buffer churn.
        this._uploadDirty = true;
        this._lastUploadProgress = NaN;

        // Shared TSL uniform nodes (WebGPU): one uTime ticks every node material,
        // uAAA gates the per-world shell identity, uBeatPulse drives the focal glow.
        // These are passed into the .tsl builders so update() keeps a single tick path.
        this.uTime = uniform(0);
        this.uAAA = uniform(this.worldShellsEnabled ? 1 : 0);
        this.uBeatPulse = uniform(0);
    }

    /**
     * QW11: mark the instanced/particle GPU buffers as needing a re-upload on the next
     * update(). Called from every state-changing entry point (hover/select/state/layout/
     * AAA toggle); camera-progress and visibility deltas are detected inside update().
     */
    _markUploadDirty() {
        this._uploadDirty = true;
    }

    setAAAVisualsEnabled(enabled) {
        const active = !!enabled;
        this.focalHierarchy = active;
        this.worldShellsEnabled = active;
        this._syncAAAVisualUniforms();
        this._markUploadDirty();
    }

    _syncAAAVisualUniforms() {
        // Shared TSL node uniform — the glass shell builder reads this same node.
        this.uAAA.value = this.worldShellsEnabled ? 1 : 0;
    }

    setCamera(camera) {
        this.camera = camera;
    }

    setPathEvaluator(evaluator) {
        this.pathEvaluator = evaluator;
    }

    _getPathPoint(t, target) {
        const clampedT = THREE.MathUtils.clamp(t, 0, 1);
        if (this.pathEvaluator) {
            return this.pathEvaluator(clampedT, target);
        }
        return this.pathCurve.getPointAt(clampedT, target);
    }

    setCameraProgress(progress) {
        this.cameraProgress = progress;
    }

    _getChapterOneNodeQuench(node) {
        if ((node?.config?.chapter ?? 1) !== 1) {
            return 0;
        }
        const chapterPositions = getActiveOdysseyChapterPositions();
        const start = chapterPositions[0] ?? 0;
        const end = chapterPositions[1] ?? 0.093;
        const span = Math.max(end - start, 1e-4);
        const local = THREE.MathUtils.clamp((this.cameraProgress - start) / span, 0, 1);
        return Math.max(
            THREE.MathUtils.smoothstep(local, CHAPTER_1_NODE_QUENCH_START, CHAPTER_1_NODE_QUENCH_END),
            THREE.MathUtils.smoothstep(this.cameraProgress, 0.078, 0.083),
        );
    }

    _createSharedLockTextures() {
        // Lock icon texture
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, 128, 128);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 10;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(64, 50, 28, Math.PI, 0, false);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(36, 50);
        ctx.lineTo(36, 65);
        ctx.moveTo(92, 50);
        ctx.lineTo(92, 65);
        ctx.stroke();
        ctx.fillStyle = '#ff4444';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.roundRect(24, 60, 80, 56, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#220000';
        ctx.beginPath();
        ctx.arc(64, 78, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(58, 82);
        ctx.lineTo(64, 102);
        ctx.lineTo(70, 82);
        ctx.closePath();
        ctx.fill();
        const lockTexture = new THREE.CanvasTexture(canvas);
        lockTexture.needsUpdate = true;

        // Lock glow texture
        const glowCanvas = document.createElement('canvas');
        glowCanvas.width = 64;
        glowCanvas.height = 64;
        const glowCtx = glowCanvas.getContext('2d');
        const gradient = glowCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
        gradient.addColorStop(0, 'rgba(255, 100, 100, 0.8)');
        gradient.addColorStop(0.5, 'rgba(255, 50, 50, 0.3)');
        gradient.addColorStop(1, 'rgba(200, 0, 0, 0)');
        glowCtx.fillStyle = gradient;
        glowCtx.fillRect(0, 0, 64, 64);
        const lockGlowTexture = new THREE.CanvasTexture(glowCanvas);

        return { lockTexture, lockGlowTexture };
    }

    rebuildPositionCache() {
        this.nodes.forEach((node) => {
            const point = this._getPathPoint(node.pathPosition);
            point.z += NODE_PATH_SURFACE_OFFSET_Z;
            this.cachedBasePositions.set(node.config.id, point.clone());
        });
    }

    async createNodes(levelData, yieldFn = null) {
        this.instanceCount = levelData.length;
        this.nodeIds = levelData.map((level) => level.id);
        this.nodeIds.forEach((id, index) => this.instanceIdMap.set(id, index));

        this._setupInstancedMeshes();

        // LEVER 1: build the shared theme-icon DataArrayTexture + the single instanced
        // inner-core mesh ONCE before the node batch loop (so layer indices exist when
        // createGlassNode assigns each node its coreLayer). Only when the flag is ON.
        if (this.coreInstanced) {
            await this._buildCoreArrayTexture(levelData);
            this._setupInnerCoreInstancedMesh();
        }

        const batchSize = 5;
        for (let i = 0; i < levelData.length; i += batchSize) {
            const batch = levelData.slice(i, i + batchSize);
            // Intentional batching keeps the loading overlay animating during node creation.
            // eslint-disable-next-line no-await-in-loop
            const batchNodes = await Promise.all(batch.map((level) => this.createNode(level)));

            const glassStyleAttr = this.glassInstancedMesh.geometry.getAttribute('aNodeStyle');
            const glassColorAttr = this.glassInstancedMesh.geometry.getAttribute('aNodeColor');
            const glassAccentAttr = this.glassInstancedMesh.geometry.getAttribute('aNodeAccentColor');
            const glassSeedAttr = this.glassInstancedMesh.geometry.getAttribute('aNodeSeed');

            batchNodes.forEach((node, index) => {
                const level = batch[index];
                this.nodes.set(level.id, node);
                this.scene.add(node.group);

                // Initialize instance matrix
                const idx = this.instanceIdMap.get(level.id);
                const matrix = new THREE.Matrix4();
                matrix.compose(
                    node.group.position,
                    node.group.quaternion,
                    node.group.scale,
                );
                this.glassInstancedMesh.setMatrixAt(idx, matrix);
                this.glowInstancedMesh.setMatrixAt(idx, matrix);

                // P3b: static per-world shell style + chapter colour for this node.
                const chapter = level.chapter || 1;
                const shell = resolveOdysseyNodeShellStyle(chapter, level.id);
                const shellColor = node.group.userData.chapterColor || new THREE.Color(shell.baseColor);
                const accentColor = new THREE.Color(shell.accentColor);
                glassStyleAttr.setX(idx, shell.index);
                glassColorAttr.setXYZ(idx, shellColor.r, shellColor.g, shellColor.b);
                glassAccentAttr.setXYZ(idx, accentColor.r, accentColor.g, accentColor.b);
                glassSeedAttr.setX(idx, shell.seed);
            });

            if (yieldFn) {
                // eslint-disable-next-line no-await-in-loop
                await yieldFn();
            }
        }

        this.glassInstancedMesh.instanceMatrix.needsUpdate = true;
        this.glassInstancedMesh.geometry.getAttribute('aNodeStyle').needsUpdate = true;
        this.glassInstancedMesh.geometry.getAttribute('aNodeColor').needsUpdate = true;
        this.glassInstancedMesh.geometry.getAttribute('aNodeAccentColor').needsUpdate = true;
        this.glassInstancedMesh.geometry.getAttribute('aNodeSeed').needsUpdate = true;
        this.glowInstancedMesh.instanceMatrix.needsUpdate = true;
        this.lockInstancedMesh.instanceMatrix.needsUpdate = true;
        this.starInstancedMesh.instanceMatrix.needsUpdate = true;

        console.log('[LevelNodes] Created', this.nodes.size, 'level nodes in batches with instancing');
    }

    _setupInstancedMeshes() {
        const count = this.instanceCount;

        // 1. Glass Instanced Mesh
        // We use a TSL NodeMaterial to support per-instance state on WebGPU.
        // P3b: when uAAA>0.5 the shell adopts a per-world identity from per-instance
        // aNodeStyle + aNodeColor (magma geode / bubble / ley-lantern / cairn-crystal /
        // cloud-wisp / starlit / lensed-shard / neon-sign). Off → the original glass.
        // The GLSL ShaderMaterial was ported to the validated createGlassShellTSL builder;
        // we feed it this manager's shared uTime/uAAA so update() ticks one source.
        const glass = createGlassShellTSL(this.uTime, this.uAAA);
        const glassMat = glass.material;

        this.glassInstancedMesh = new THREE.InstancedMesh(this.sharedGlassGeo, glassMat, count);
        this.glassInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

        // Custom attributes
        const stateArray = new Float32Array(count * 4);
        this.glassInstancedMesh.geometry.setAttribute('aState', new THREE.InstancedBufferAttribute(stateArray, 4));

        // P3b: per-instance shell style + chapter colour (static; set in createNodes).
        const nodeStyleArray = new Float32Array(count);
        const nodeColorArray = new Float32Array(count * 3);
        const nodeAccentColorArray = new Float32Array(count * 3);
        const nodeSeedArray = new Float32Array(count);
        this.glassInstancedMesh.geometry.setAttribute(
            'aNodeStyle',
            new THREE.InstancedBufferAttribute(nodeStyleArray, 1),
        );
        this.glassInstancedMesh.geometry.setAttribute(
            'aNodeColor',
            new THREE.InstancedBufferAttribute(nodeColorArray, 3),
        );
        this.glassInstancedMesh.geometry.setAttribute(
            'aNodeAccentColor',
            new THREE.InstancedBufferAttribute(nodeAccentColorArray, 3),
        );
        this.glassInstancedMesh.geometry.setAttribute(
            'aNodeSeed',
            new THREE.InstancedBufferAttribute(nodeSeedArray, 1),
        );

        this.scene.add(this.glassInstancedMesh);

        // 2. Glow Instanced Mesh
        // P3 focal hierarchy: aState.z flags the player's "current" node so it blazes
        // and beat-pulses (uBeatPulse). z stays 0 unless focalHierarchy is enabled, so
        // the default look is unchanged. Ported to createGlowHaloTSL, sharing this
        // manager's uTime/uBeatPulse uniforms.
        const glow = createGlowHaloTSL(this.uTime, this.uBeatPulse);
        const glowMat = glow.material;

        this.glowInstancedMesh = new THREE.InstancedMesh(this.sharedGlowGeo, glowMat, count);
        this.glowInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

        const colorArray = new Float32Array(count * 3);
        const glowStateArray = new Float32Array(count * 3);
        this.glowInstancedMesh.geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(colorArray, 3));
        this.glowInstancedMesh.geometry.setAttribute('aState', new THREE.InstancedBufferAttribute(glowStateArray, 3));

        this.scene.add(this.glowInstancedMesh);

        // 3. Lock Instanced Mesh (Plane Mesh)
        // The lock is placed in FRONT of its own orb (offset toward the camera in
        // _updateIndicatorBillboards) so the orb's opaque core never occludes it, and a high
        // renderOrder paints it after the (depth-write-free) glass shell/glow. depthTest stays
        // ON so a FAR level's lock can't bleed over a nearer orb. DoubleSide (was BackSide — a
        // latent bug that dropped it at grazing angles) keeps it visible whichever way it faces.
        const lockGeo = new THREE.PlaneGeometry(0.9, 0.9);
        const lockMat = new THREE.MeshBasicMaterial({
            map: this.sharedLockTextures.lockTexture,
            transparent: true,
            alphaTest: 0.1,
            depthWrite: false,
            side: THREE.DoubleSide,
        });
        this.lockInstancedMesh = new THREE.InstancedMesh(lockGeo, lockMat, count);
        this.lockInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.lockInstancedMesh.renderOrder = 10; // Paint after the orb shells/glow
        this.scene.add(this.lockInstancedMesh);

        // 4. Star Instanced Mesh (Plane Mesh) - 3 stars per level
        // Same treatment as the lock: placed in front of the orb (so the core can't hide it)
        // with a high renderOrder, depthTest kept on (so a far level's stars can't bleed over
        // a nearer orb — that bleed was making stars look like they sat on unfinished levels).
        const starGeo = new THREE.PlaneGeometry(0.7, 0.7);
        const starMat = new THREE.MeshBasicMaterial({
            map: this.sharedStarTexture,
            transparent: true,
            opacity: 0.74,
            alphaTest: 0.1,
            depthWrite: false,
            side: THREE.DoubleSide,
        });
        this.starInstancedMesh = new THREE.InstancedMesh(starGeo, starMat, count * 3);
        this.starInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.starInstancedMesh.renderOrder = 10; // Paint after the orb shells/glow
        this.scene.add(this.starInstancedMesh);

        // 5. High-Fidelity Particles (instanced billboard quads on WebGPU)
        // 96 particles per node * 55 nodes = ~5280 particles in one draw call.
        // THREE.Points renders as 1px on WebGPU, so the sparkle cloud is drawn as
        // camera-facing instanced quads via createNodeParticlesTSL + the shared billboard
        // helper. Per-particle attributes (aOffset/aPState/aNodePos/aNodeScale/aNodeLocked)
        // are identical to the old GLSL Points and are still ticked in update().
        const particleCountPerNode = 96; // trimmed from 128 (always-present sparkle cloud); MUST match in build + update
        const totalParticles = count * particleCountPerNode;

        const offsetArray = new Float32Array(totalParticles * 3); // Position within the orb
        const pStateArray = new Float32Array(totalParticles * 2); // x: speed mult, y: phase offset

        for (let i = 0; i < count; i++) {
            for (let j = 0; j < particleCountPerNode; j++) {
                const idx = i * particleCountPerNode + j;

                // Random point inside sphere r=0.8
                const r = Math.random() * 0.8;
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.acos(2 * Math.random() - 1);

                offsetArray[idx * 3] = r * Math.sin(phi) * Math.cos(theta);
                offsetArray[idx * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
                offsetArray[idx * 3 + 2] = r * Math.cos(phi);

                pStateArray[idx * 2] = 0.5 + Math.random(); // speed
                pStateArray[idx * 2 + 1] = Math.random() * Math.PI * 2; // phase
            }
        }

        // Per-node placement attributes (updated each frame from node positions/state).
        const nodePosArray = new Float32Array(totalParticles * 3);
        const nodeScaleArray = new Float32Array(totalParticles);
        const nodeLockedArray = new Float32Array(totalParticles);

        // Instanced billboard-quad geometry carries all per-particle attributes.
        const particleGeo = createNodeParticleGeometry(totalParticles, {
            offsetArray,
            pStateArray,
            nodePosArray,
            nodeScaleArray,
            nodeLockedArray,
        });

        const particles = createNodeParticlesTSL(this.uTime);
        const particleMat = particles.material;

        this.particleSystem = new THREE.Mesh(particleGeo, particleMat);
        this.particleSystem.frustumCulled = false; // Always update all for now, or chunk it
        this.scene.add(this.particleSystem);
    }

    /**
     * Create a single level node
     * @param {Object} levelConfig
     * @returns {Object}
     */
    async createNode(levelConfig) {
        return this.createGlassNode(levelConfig);
    }

    async createGlassNode(levelConfig) {
        const group = new THREE.Group();
        group.userData.levelId = levelConfig.id;
        group.userData.locked = true;
        group.userData.completed = false;
        group.userData.stars = 0;
        const chapter = levelConfig.chapter || 1;
        const chapterColor = this.getChapterColor(chapter);
        const baseScale = CHAPTER_NODE_BASE_SCALE[chapter] ?? 1.0;
        group.userData.baseScale = baseScale;
        group.scale.setScalar(baseScale);

        // Position on path
        const pathPosition = levelConfig.pathPosition || (levelConfig.id - 1) / 55;
        const point = this._getPathPoint(pathPosition);
        group.position.copy(point);
        group.position.z += NODE_PATH_SURFACE_OFFSET_Z;

        // Cache the base position for per-frame floating animation (avoids getPointAt per frame)
        this.cachedBasePositions.set(levelConfig.id, group.position.clone());

        // 1. Inner "Theme" Sphere (Solid textured sphere inside)
        let innerMesh = null;
        let innerMat = null;
        if (this.coreInstanced) {
            // LEVER 1: the shared inner-core InstancedMesh draws this core. Store its atlas
            // layer so update() can write the per-instance aCore attribute; no per-node mesh
            // or material (that is the 55→1 pipeline/draw collapse). -1 = no icon → magma.
            group.userData.coreLayer = this.levelLayer.get(levelConfig.id) ?? -1;
        } else {
            const themeId = levelConfig.iconThemeId
                || levelConfig.theme?.pathIcon
                || levelConfig.theme?.primary;
            const themeTex = await this.getOrLoadThemeTexture(themeId);

            // Inner sphere acts as the solid core, hiding the path line that passes through
            innerMat = this.createFluidInnerMaterial(themeTex, chapterColor, levelConfig.id);
            innerMesh = new THREE.Mesh(this.sharedInnerGeo, innerMat);
            // Suspend a smaller themed core inside the clear glass shell (snow-globe read).
            innerMesh.scale.setScalar(INNER_CORE_DISPLAY_SCALE);
            group.add(innerMesh);
        }

        // 2. Outer Glass Sphere (Moved to InstancedMesh)
        // The interactive shell is now handled by the shared instanced mesh.

        // 3. Internal Particles (Moved to Instanced System)
        // We no longer add particles to individual groups

        // Standard UI Elements (Moved to Instanced System)
        // We no longer create individual lock/star groups

        // Store chapter color for instanced glow
        group.userData.chapterColor = chapterColor;

        return {
            group,
            coreMesh: innerMesh,
            coreMaterial: innerMat,
            config: levelConfig,
            pathPosition,
            isGlassNode: true,
            innerMesh,
        };
    }

    async getOrLoadThemeTexture(themeId) {
        const iconUrl = await resolveThemeIconAssetUrl(themeId, THEME_ICON_LOOKUP);
        if (!iconUrl) {
            return null;
        }

        if (this.themeTextureCache.has(iconUrl)) {
            return this.themeTextureCache.get(iconUrl);
        }

        if (this.themeTextureLoads.has(iconUrl)) {
            return this.themeTextureLoads.get(iconUrl);
        }

        const loadPromise = new Promise((resolve) => {
            this.textureLoader.load(
                iconUrl,
                (texture) => {
                    texture.colorSpace = THREE.SRGBColorSpace;
                    this.themeTextureCache.set(iconUrl, texture);
                    this.themeTextureLoads.delete(iconUrl);
                    resolve(texture);
                },
                undefined,
                (error) => {
                    console.warn(
                        `[LevelNodes] Failed to load theme icon texture for "${themeId || 'unknown'}":`,
                        error,
                    );
                    this.themeTextureLoads.delete(iconUrl);
                    resolve(null);
                },
            );
        });

        this.themeTextureLoads.set(iconUrl, loadPromise);
        return loadPromise;
    }

    createFluidInnerMaterial(themeTex, chapterColor, levelId) {
        // Ported to the validated createFluidInnerTSL builder (TSL NodeMaterial for
        // WebGPU). When themeTex is null the builder uses the procedural fallback colour
        // unconditionally (matches the old uUseTexture=0 path). The builder's `uniforms`
        // object is attached as material.uniforms so setNodeState/setNodeHovered/
        // setNodeSelected/update keep reading node.coreMaterial.uniforms.<x>.value.
        const { material, uniforms } = createFluidInnerTSL(
            themeTex || null,
            chapterColor,
            levelId,
            this.uTime,
        );
        material.uniforms = uniforms;
        return material;
    }

    /**
     * LEVER 1 — build the shared theme-icon DataArrayTexture (one layer per DISTINCT resolved
     * icon url; layer 0 reserved = white fallback). Distinct themeIds dedup onto layers
     * (mirrors themeTextureCache keyed by iconUrl). All layers are forced to coreAtlasSize²
     * by redrawing each icon through a canvas (DataArrayTexture requires uniform layer dims).
     * Icons decode async + back-fill into their layer; until then a node shows the procedural
     * magma fallback (aCore.x = -1), identical to today's null-texture path.
     */
    async _buildCoreArrayTexture(levelData) {
        const SZ = this.coreAtlasSize;
        this.iconUrlToLayer = new Map();
        this.levelLayer = new Map();
        const urlByLevel = new Map();
        await Promise.all(levelData.map(async (level) => {
            const themeId = level.iconThemeId || level.theme?.pathIcon || level.theme?.primary;
            const iconUrl = await resolveThemeIconAssetUrl(themeId, THEME_ICON_LOOKUP);
            if (iconUrl) urlByLevel.set(level.id, iconUrl);
        }));
        let nextLayer = 1; // layer 0 = white fallback
        urlByLevel.forEach((url, levelId) => {
            if (!this.iconUrlToLayer.has(url)) {
                this.iconUrlToLayer.set(url, nextLayer);
                nextLayer += 1;
            }
            this.levelLayer.set(levelId, this.iconUrlToLayer.get(url));
        });
        levelData.forEach((level) => {
            if (!this.levelLayer.has(level.id)) this.levelLayer.set(level.id, -1);
        });
        const LAYERS = Math.max(this.iconUrlToLayer.size + 1, 1);
        const data = new Uint8Array(SZ * SZ * 4 * LAYERS).fill(255); // white = safe fallback
        this.coreArrayTexture = new THREE.DataArrayTexture(data, SZ, SZ, LAYERS);
        this.coreArrayTexture.colorSpace = THREE.SRGBColorSpace;
        this.coreArrayTexture.minFilter = THREE.LinearFilter;
        this.coreArrayTexture.magFilter = THREE.LinearFilter;
        this.coreArrayTexture.generateMipmaps = false;
        this.coreArrayTexture.needsUpdate = true;
        // Async back-fill: decode each distinct icon and blit it into its layer.
        this.iconUrlToLayer.forEach((layer, url) => {
            this.textureLoader.load(url, (tex) => {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = SZ;
                    canvas.height = SZ;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(tex.image, 0, 0, SZ, SZ); // normalize any size → SZ²
                    const img = ctx.getImageData(0, 0, SZ, SZ).data;
                    this.coreArrayTexture.image.data.set(img, layer * SZ * SZ * 4);
                    this.coreArrayTexture.needsUpdate = true;
                    tex.dispose(); // only needed the decoded pixels
                    this._markUploadDirty(); // re-run update() so aCore.x flips to the real layer
                } catch (err) {
                    console.warn('[LevelNodes] core atlas blit failed for', url, err);
                }
            });
        });
    }

    /** LEVER 1 — the single InstancedMesh that draws all inner cores (8-buffer-safe: sphere
     *  position+normal+uv = 3 + instanceMatrix = 4 + the ONE packed aCore vec4 = 8). */
    _setupInnerCoreInstancedMesh() {
        const count = this.instanceCount;
        const inner = createFluidInnerInstancedTSL(this.coreArrayTexture, this.uTime);
        this.innerCoreMaterial = inner.material;
        this.innerCoreMesh = new THREE.InstancedMesh(this.sharedInnerGeo, inner.material, count);
        this.innerCoreMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.innerCoreMesh.frustumCulled = false;
        this.innerCoreMesh.geometry.setAttribute(
            'aCore',
            new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4),
        );
        // MUST-FIX: seed scale-0 matrices so nothing renders at the world origin before the
        // first update() composes each instance (the shells set theirs in createNodes).
        const zero = this._scratchMatrix2.makeScale(0, 0, 0);
        for (let i = 0; i < count; i += 1) this.innerCoreMesh.setMatrixAt(i, zero);
        this.innerCoreMesh.instanceMatrix.needsUpdate = true;
        this.scene.add(this.innerCoreMesh);
    }

    /** LEVER 1 — pack a THREE.Color into one float as 5-5-5 bits (exact in float32, ≤32767). */
    _packCoreFallback(color) {
        const r = Math.min(31, Math.floor((color?.r ?? 1) * 31));
        const g = Math.min(31, Math.floor((color?.g ?? 1) * 31));
        const b = Math.min(31, Math.floor((color?.b ?? 1) * 31));
        return (r * 1024) + (g * 32) + b;
    }

    createFallbackIconTexture() {
        const data = new Uint8Array([255, 255, 255, 255]);
        const texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;
        return texture;
    }
    // Old sprite methods removed

    /**
     * Create a 5-pointed star texture via canvas
     * @param {number} size - Canvas size
     * @returns {THREE.CanvasTexture}
     */
    createStarTexture(size) {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        const cx = size / 2;
        const cy = size / 2;
        const outerRadius = size * 0.4;
        const innerRadius = size * 0.18;
        const spikes = 5;

        // Clear
        ctx.clearRect(0, 0, size, size);

        // Draw star with gradient fill
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, outerRadius);
        gradient.addColorStop(0, '#ffffcc'); // Bright center
        gradient.addColorStop(0.3, '#ffdd00'); // Golden
        gradient.addColorStop(0.7, '#ffaa00'); // Deep gold
        gradient.addColorStop(1, '#ff8800'); // Orange edge

        ctx.fillStyle = gradient;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.beginPath();

        for (let i = 0; i < spikes * 2; i++) {
            const radius = i % 2 === 0 ? outerRadius : innerRadius;
            const angle = (i * Math.PI) / spikes - Math.PI / 2;
            const x = cx + Math.cos(angle) * radius;
            const y = cy + Math.sin(angle) * radius;
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Add shine highlight
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.beginPath();
        ctx.arc(cx - outerRadius * 0.2, cy - outerRadius * 0.2, outerRadius * 0.15, 0, Math.PI * 2);
        ctx.fill();

        return new THREE.CanvasTexture(canvas);
    }

    /**
     * Create a radial glow texture for sprites
     * @param {number} size - Texture size
     * @returns {THREE.CanvasTexture}
     */
    createGlowTexture(size) {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        const gradient = ctx.createRadialGradient(
            size / 2,
            size / 2,
            0,
            size / 2,
            size / 2,
            size / 2,
        );
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(0.2, 'rgba(255, 220, 100, 0.8)');
        gradient.addColorStop(0.5, 'rgba(255, 180, 50, 0.3)');
        gradient.addColorStop(1, 'rgba(255, 150, 0, 0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, size, size);

        return new THREE.CanvasTexture(canvas);
    }

    getChapterColor(chapter) {
        // ═══════════════════════════════════════════════════════════════════
        // VIBRANT CHAPTER COLORS - Saturated and eye-catching
        // ═══════════════════════════════════════════════════════════════════
        return new THREE.Color(getChapterProfile(chapter).palette?.primary ?? 0xffffff);
    }

    /**
     * Update nodes from player progress
     * @param {Object} progressData
     */
    updateFromProgress(progressData) {
        if (!progressData?.levelProgress) return;

        this.nodes.forEach((node, levelId) => {
            const levelProgress = progressData.levelProgress[levelId];
            const isUnlocked = levelId <= (progressData.furthestLevel || 1);
            const isCompleted = levelProgress?.completed || false;
            const stars = levelProgress?.stars || 0;

            this.setNodeState(levelId, {
                locked: !isUnlocked,
                completed: isCompleted,
                stars,
            });
        });

        // P3: the "current" node = the lowest unlocked level not yet completed
        // (the one the player should play next), else the furthest unlocked.
        const furthest = progressData.furthestLevel || 1;
        let current = furthest;
        for (let id = 1; id <= furthest; id += 1) {
            if (!progressData.levelProgress[id]?.completed) {
                current = id;
                break;
            }
        }
        this.currentLevelId = current;
        // QW11: progress changes the focal/lock/star/glow attribute set → re-upload once.
        this._markUploadDirty();
    }

    /**
     * Set state for a specific node
     */
    setNodeState(levelId, state) {
        const node = this.nodes.get(levelId);
        if (!node) return;

        node.group.userData.locked = state.locked;
        node.group.userData.completed = state.completed;
        node.group.userData.stars = state.stars;

        // Update core material uniforms (this is the inner fluid sphere)
        if (node.coreMaterial?.uniforms) {
            if (node.coreMaterial.uniforms.uLocked) {
                node.coreMaterial.uniforms.uLocked.value = state.locked ? 1.0 : 0.0;
            }
            if (node.coreMaterial.uniforms.uCompleted) {
                node.coreMaterial.uniforms.uCompleted.value = state.completed ? 1.0 : 0.0;
            }
        }

        // Instanced UI (Lock, Stars) states are handled in update() based on userData below
        // Note: Glass and Glow effects are handled by InstancedMesh in update()
        // which pulls state from node.group.userData updated above.
        // QW11: locked/completed/stars feed the instanced attributes → flag a re-upload.
        this._markUploadDirty();
    }

    /**
     * Set hover state for a node
     */
    setNodeHovered(levelId, hovered) {
        const node = this.nodes.get(levelId);
        if (!node) {
            this.hoveredNode = null;
            return;
        }

        const isHovered = hovered ? 1.0 : 0.0;

        // Update core material uniforms if they exist
        if (node.coreMaterial?.uniforms?.uHovered) {
            node.coreMaterial.uniforms.uHovered.value = isHovered;
        }

        // Scale up on hover
        const baseScale = node.group.userData.baseScale ?? 1.0;
        const targetScale = baseScale * (hovered ? 1.16 : 1.0);
        node.group.scale.setScalar(targetScale);

        this.hoveredNode = hovered ? levelId : null;
        // QW11: hover changes the glass/glow aState + node scale matrices → re-upload.
        this._markUploadDirty();
    }

    /**
     * Set selected state for a node
     */
    setNodeSelected(levelId, selected) {
        const node = this.nodes.get(levelId);
        if (!node) {
            this.selectedNode = null;
            return;
        }

        const isSelected = selected ? 1.0 : 0.0;

        // Update core material uniforms if they exist
        if (node.coreMaterial?.uniforms?.uSelected) {
            node.coreMaterial.uniforms.uSelected.value = isSelected;
        }

        this.selectedNode = selected ? levelId : null;
        // QW11: selection changes the glass aState (w) → re-upload.
        this._markUploadDirty();
    }

    /**
     * Get position of a node
     */
    getNodePosition(levelId) {
        const node = this.nodes.get(levelId);
        return node?.group.position.clone();
    }

    updateLayout(levelData = [], pathCurve = null) {
        if (pathCurve) {
            this.pathCurve = pathCurve;
        }

        levelData.forEach((level) => {
            const node = this.nodes.get(level.id);
            if (!node) return;

            node.config = {
                ...node.config,
                pathPosition: level.pathPosition,
            };
            node.pathPosition = level.pathPosition;
            this.updateNodePathPlacement(node);
        });

        // If the path curve changed, rebuild all cached positions
        if (pathCurve) {
            this.rebuildPositionCache();
        }
        // QW11: layout moved node positions → instance matrices/particles need re-upload.
        this._markUploadDirty();
    }

    /**
     * Update path placement for a single node.
     * @param {Object} node - Node object (result of createNode)
     */
    updateNodePathPlacement(node) {
        if (!node) return;

        const point = this._getPathPoint(node.pathPosition);
        node.group.position.copy(point);
        node.group.position.z += NODE_PATH_SURFACE_OFFSET_Z;
        // Refresh cached base position
        this.cachedBasePositions.set(node.config.id, node.group.position.clone());
    }

    /**
     * Get projected screen-space metrics for a node's orb.
     * Used by the portal transition so the breach opens from the actual orb radius.
     * @param {number} levelId
     * @param {THREE.Camera} camera
     * @returns {{center: {x: number, y: number}, radius: number, onScreen: boolean, worldPosition: THREE.Vector3}|null}
     */
    getNodeCinematicMetrics(levelId, camera) {
        const node = this.nodes.get(levelId);
        if (!node?.group || !camera) {
            return null;
        }

        const worldPosition = new THREE.Vector3();
        const worldRight = new THREE.Vector3();
        const worldUp = new THREE.Vector3();
        const cameraQuaternion = new THREE.Quaternion();

        node.group.getWorldPosition(worldPosition);
        camera.getWorldQuaternion(cameraQuaternion);

        const scale = Math.max(
            Math.abs(node.group.scale.x || 1),
            Math.abs(node.group.scale.y || 1),
            Math.abs(node.group.scale.z || 1),
        );
        const orbRadiusWorld = GLASS_OUTER_RADIUS * scale;

        worldRight.set(1, 0, 0).applyQuaternion(cameraQuaternion).multiplyScalar(orbRadiusWorld);
        worldUp.set(0, 1, 0).applyQuaternion(cameraQuaternion).multiplyScalar(orbRadiusWorld);

        const centerNdc = worldPosition.clone().project(camera);
        const rightNdc = worldPosition.clone().add(worldRight).project(camera);
        const upNdc = worldPosition.clone().add(worldUp).project(camera);

        const center = {
            x: (centerNdc.x + 1) * 0.5,
            y: (1 - centerNdc.y) * 0.5,
        };
        const radiusX = Math.hypot(
            ((rightNdc.x + 1) * 0.5) - center.x,
            ((1 - rightNdc.y) * 0.5) - center.y,
        );
        const radiusY = Math.hypot(
            ((upNdc.x + 1) * 0.5) - center.x,
            ((1 - upNdc.y) * 0.5) - center.y,
        );
        const radius = Math.max(radiusX, radiusY);
        const onScreen = centerNdc.z >= -1
            && centerNdc.z <= 1
            && center.x >= 0
            && center.x <= 1
            && center.y >= 0
            && center.y <= 1
            && Number.isFinite(radius)
            && radius > 0;

        return {
            center,
            radius: Number.isFinite(radius) ? radius : 0,
            onScreen,
            worldPosition,
        };
    }

    /**
     * Raycast to find hovered node
     * @returns {number|null} Level ID or null
     */
    /**
     * Raycast against level nodes
     * @param {THREE.Raycaster} raycaster
     * @returns {number|null} Level ID or null
     */
    raycast(raycaster) {
        if (!this.glassInstancedMesh) return null;

        const intersects = raycaster.intersectObject(this.glassInstancedMesh);
        if (intersects.length > 0) {
            const [{ instanceId }] = intersects;
            const levelId = this.nodeIds[instanceId];
            const node = this.nodes.get(levelId);

            // Only interact if not locked
            if (node && !node.group.userData.locked) {
                return levelId;
            }
        }
        return null;
    }

    /**
     * Update animation
     * @param {number} deltaTime
     * @param {number} [beatPulse] - director beat pulse (AAA focal hierarchy)
     */
    update(deltaTime, beatPulse = 0) {
        this.time += deltaTime;
        this.frameCount += 1;
        this._beatPulse = beatPulse;

        if (!this.glassInstancedMesh
            || !this.glowInstancedMesh
            || !this.particleSystem
            || !this.camera
            || !this.lockInstancedMesh
            || !this.starInstancedMesh) {
            return;
        }

        // Tick the shared TSL node uniforms (one source feeds glass/glow/particles/inner).
        // These ALWAYS tick (even when the buffers are clean) so the in-shader sparkle /
        // iridescence / focal beat-pulse keep animating between settled frames.
        this.uTime.value = this.time;
        this.uBeatPulse.value = this.focalHierarchy ? beatPulse : 0;

        // QW11: detect camera/progress movement (also covers visibility flips, which are
        // derived from |pathPosition - cameraProgress|). Combined with the interaction
        // dirty flag, this decides whether the per-node CPU loop + GPU buffer re-upload
        // runs this frame. When nothing changed we early-out and let the shaders animate.
        const progressMoved = !(Math.abs(this.cameraProgress - this._lastUploadProgress)
            <= UPDATE_PROGRESS_EPSILON); // NaN-safe: first frame forces a flush.
        const needsUpload = this._uploadDirty || progressMoved;
        if (!needsUpload) {
            // The heavy glass/glow/particle buffers are settled, but the camera can still
            // move without path progress changing (free-look / idle sway). Keep the cheap
            // lock/star billboards tracking the camera so they always read above the orb.
            this._updateIndicatorBillboards(false);
            return;
        }
        this._uploadDirty = false;
        this._lastUploadProgress = this.cameraProgress;

        const glassStateAttr = this.glassInstancedMesh.geometry.getAttribute('aState');
        const glowColorAttr = this.glowInstancedMesh.geometry.getAttribute('aColor');
        const glowStateAttr = this.glowInstancedMesh.geometry.getAttribute('aState');
        // LEVER 1: the packed per-instance core attribute (null when the lever is OFF).
        const aCoreAttr = this.innerCoreMesh ? this.innerCoreMesh.geometry.getAttribute('aCore') : null;

        const particleCountPerNode = 96; // trimmed from 128 (always-present sparkle cloud); MUST match in build + update
        const particleNodePosAttr = this.particleSystem.geometry.getAttribute('aNodePos');
        const particleNodeScaleAttr = this.particleSystem.geometry.getAttribute('aNodeScale');
        const particleNodeLockedAttr = this.particleSystem.geometry.getAttribute('aNodeLocked');

        // Reused scratch (hoisted to the instance) — no per-node allocation below.
        const matrix = this._scratchMatrix;

        this.nodes.forEach((node) => {
            const levelId = node.config.id;
            const idx = this.instanceIdMap.get(levelId);
            const distance = Math.abs(node.pathPosition - this.cameraProgress);
            const chapterOneQuench = this._getChapterOneNodeQuench(node);

            // Strict visibility culling
            const isVisible = distance < (UPDATE_PROXIMITY_THRESHOLD * 1.5)
                && chapterOneQuench < 0.98;
            node.group.visible = isVisible;

            if (!isVisible) {
                matrix.makeScale(0, 0, 0);
                this.glassInstancedMesh.setMatrixAt(idx, matrix);
                this.glowInstancedMesh.setMatrixAt(idx, matrix);
                this.lockInstancedMesh.setMatrixAt(idx, matrix);
                for (let s = 0; s < 3; s++) this.starInstancedMesh.setMatrixAt(idx * 3 + s, matrix);
                // LEVER 1: scale-0 cull the inner core too (same matrix the shells use).
                if (this.innerCoreMesh) this.innerCoreMesh.setMatrixAt(idx, matrix);

                // Hide particles for this node
                for (let p = 0; p < particleCountPerNode; p++) {
                    particleNodeScaleAttr.setX(idx * particleCountPerNode + p, 0);
                }
                return;
            }

            const isNear = distance < UPDATE_PROXIMITY_THRESHOLD;

            // Floating animation: bob on X, Y, Z slowly and organically around base position
            const basePos = this.cachedBasePositions.get(levelId);
            if (basePos) {
                const floatX = Math.sin(this.time * 0.8 + levelId * 1.5) * 0.12;
                const floatY = Math.sin(this.time * 1.2 + levelId * 2.2) * 0.12;
                const floatZ = Math.cos(this.time * 0.9 + levelId * 0.7) * 0.12;
                node.group.position.set(
                    basePos.x + floatX,
                    basePos.y + floatY,
                    basePos.z + floatZ,
                );
            }
            const baseScale = node.group.userData.baseScale ?? 1.0;
            const hoverScale = this.hoveredNode === levelId ? 1.16 : 1.0;
            const quenchScale = THREE.MathUtils.lerp(1.0, CHAPTER_1_NODE_MIN_SCALE, chapterOneQuench);
            node.group.scale.setScalar(baseScale * hoverScale * quenchScale);
            if (node.innerMesh) {
                node.innerMesh.visible = chapterOneQuench < 0.92;
            }

            // Sync instance matrices
            matrix.compose(node.group.position, node.group.quaternion, node.group.scale);
            this.glassInstancedMesh.setMatrixAt(idx, matrix);
            this.glowInstancedMesh.setMatrixAt(idx, matrix);

            // Lock/star indicator PLACEMENT now runs every frame in _updateIndicatorBillboards()
            // (camera-relative + drawn on top) so it tracks free-look / idle camera moves where
            // path progress — and thus this gated block — is frozen. Here we only still read
            // locked/completed because the glass/glow/particle attributes below depend on them;
            // invisible nodes are zeroed in the !isVisible branch above.
            const isLocked = node.group.userData.locked;
            const isCompleted = node.group.userData.completed;

            // Sync particle attributes
            for (let p = 0; p < particleCountPerNode; p++) {
                const pIdx = idx * particleCountPerNode + p;
                particleNodePosAttr.setXYZ(pIdx, node.group.position.x, node.group.position.y, node.group.position.z);
                particleNodeScaleAttr.setX(pIdx, node.group.scale.x);
                particleNodeLockedAttr.setX(pIdx, isLocked ? 1.0 : 0.0);
            }

            // Sync instance attributes
            const isHovered = (this.hoveredNode === levelId) ? 1.0 : 0.0;
            const isSelected = (this.selectedNode === levelId) ? 1.0 : 0.0;

            glassStateAttr.setXYZW(idx, isLocked ? 1.0 : 0.0, isCompleted ? 1.0 : 0.0, isHovered, isSelected);

            // LEVER 1: inner-core instance matrix + packed aCore vec4. The legacy per-node
            // innerMesh was a child scaled by INNER_CORE_DISPLAY_SCALE and hidden when
            // chapterOneQuench >= 0.92; reproduce both here (scale 0 = hidden). aCore packs
            // layer+0.5 / -1, seed, the locked|completed|hovered|selected bitfield, and the
            // 5-5-5 fallback colour. setNode*/hover/select mark dirty so this reflushes.
            if (this.coreInstanced && this.innerCoreMesh && aCoreAttr) {
                const innerScale = chapterOneQuench < 0.92
                    ? node.group.scale.x * INNER_CORE_DISPLAY_SCALE
                    : 0;
                const innerMat4 = this._scratchMatrix2.compose(
                    node.group.position,
                    node.group.quaternion,
                    this._scratchInnerScaleVec.setScalar(innerScale),
                );
                this.innerCoreMesh.setMatrixAt(idx, innerMat4);
                const layer = node.group.userData.coreLayer ?? -1;
                const layerEnc = layer >= 0 ? (layer + 0.5) : -1.0;
                const coreSeed = ((levelId || 1) * 0.61803398875) % 1000;
                const stateBits = (isLocked ? 1 : 0) + (isCompleted ? 2 : 0)
                    + (isHovered > 0.5 ? 4 : 0) + (isSelected > 0.5 ? 8 : 0);
                const packedFb = this._packCoreFallback(node.group.userData.chapterColor);
                aCoreAttr.setXYZW(idx, layerEnc, coreSeed, stateBits, packedFb);
            }

            // QW11: reuse a shared fallback Color instead of allocating one per node.
            const color = node.group.userData.chapterColor || this._fallbackColor;
            glowColorAttr.setXYZ(idx, color.r, color.g, color.b);
            const isCurrent = (this.focalHierarchy && levelId === this.currentLevelId && !isLocked) ? 1.0 : 0.0;
            glowStateAttr.setXYZ(idx, isLocked ? 1.0 : 0.0, isHovered, isCurrent);

            if (isNear) {
                if (node.coreMaterial?.uniforms?.uTime) {
                    node.coreMaterial.uniforms.uTime.value = this.time;
                }
            }
        });

        // QW11: this whole re-upload block is reached only when needsUpload was true
        // (camera moved / visibility / hover / select / state / layout changed). When the
        // board is settled we early-out above, so the ~7040-particle + 4 instanced-buffer
        // GPU re-upload no longer happens every frame.
        this.glassInstancedMesh.instanceMatrix.needsUpdate = true;
        this.glowInstancedMesh.instanceMatrix.needsUpdate = true;
        this.lockInstancedMesh.instanceMatrix.needsUpdate = true;
        this.starInstancedMesh.instanceMatrix.needsUpdate = true;
        if (this.innerCoreMesh && aCoreAttr) {
            this.innerCoreMesh.instanceMatrix.needsUpdate = true;
            aCoreAttr.needsUpdate = true;
        }
        glassStateAttr.needsUpdate = true;
        glowColorAttr.needsUpdate = true;
        glowStateAttr.needsUpdate = true;

        particleNodePosAttr.needsUpdate = true;
        particleNodeScaleAttr.needsUpdate = true;
        particleNodeLockedAttr.needsUpdate = true;
        // particle uTime is the shared node uniform ticked at the top of update().

        // Re-place the lock/star billboards against the current camera. Forced because the
        // gated block just moved node positions (float Y) / state this frame.
        this._updateIndicatorBillboards(true);
    }

    /**
     * Place the lock / star indicator billboards in screen space against the CURRENT camera
     * so they always read directly above the orb, face the camera, and sit slightly toward it
     * (near hemisphere). Combined with the materials' depthTest:false + high renderOrder, the
     * indicators are never occluded by the orb at any viewing angle.
     *
     * Runs every frame — decoupled from the gated glass/glow/particle re-upload in update() —
     * because the camera can rotate without path progress changing (free-look / idle sway), and
     * the indicators must keep tracking it. Only visible nodes are written here; invisible nodes
     * are scaled to 0 by the gated update() loop and skipped.
     * @param {boolean} forcePlace - re-place even when the camera matrix is unchanged (the gated
     *   block just moved node positions / state this frame).
     */
    _updateIndicatorBillboards(forcePlace = false) {
        if (!this.lockInstancedMesh || !this.starInstancedMesh || !this.camera) {
            return;
        }

        // The follow camera's lookAt only updates its quaternion; matrixWorld is refreshed at
        // render time. Refresh it here so the camera-up basis below reflects THIS frame's angle
        // (otherwise the "upper side of the orb" offset would lag a frame behind a turning camera).
        this.camera.updateMatrixWorld();

        // Skip the re-upload when the board is fully settled (no camera movement) — preserves
        // the QW11 "no per-frame GPU churn" win. Any real camera move re-flushes immediately.
        const cameraMoved = !this.camera.matrixWorld.equals(this._lastIndicatorCamMatrix);
        if (!forcePlace && !cameraMoved) {
            return;
        }
        this._lastIndicatorCamMatrix.copy(this.camera.matrixWorld);

        const matrix = this._scratchMatrix;
        const scaleVec = this._scratchScaleVec;
        // Camera basis (world space): right = column 0, up = column 1, eye = column 3.
        const camRight = this._scratchCamRight.setFromMatrixColumn(this.camera.matrixWorld, 0).normalize();
        const camUp = this._scratchCamUp.setFromMatrixColumn(this.camera.matrixWorld, 1).normalize();
        const camPos = this._scratchCamPos.setFromMatrixColumn(this.camera.matrixWorld, 3);

        this.nodes.forEach((node) => {
            // Invisible nodes are scaled to 0 by the gated update() loop; nothing to place.
            if (!node.group.visible) {
                return;
            }
            const idx = this.instanceIdMap.get(node.config.id);
            const scale = node.group.scale.x;
            const pos = node.group.position;
            const toCam = this._scratchToCam.copy(camPos).sub(pos).normalize();

            // Lock — single billboard centred above the orb, facing the camera.
            if (node.group.userData.locked) {
                matrix.copy(this.camera.matrixWorld);
                matrix.setPosition(this._scratchIndicatorPos.copy(pos)
                    .addScaledVector(camUp, LOCK_PLACEMENT.up * scale)
                    .addScaledVector(toCam, LOCK_PLACEMENT.toward * scale));
                const s = scale * 0.9;
                matrix.scale(scaleVec.set(s, s, s));
                this.lockInstancedMesh.setMatrixAt(idx, matrix);
            } else {
                this.lockInstancedMesh.setMatrixAt(idx, matrix.makeScale(0, 0, 0));
            }

            // Stars — up to 3, arced above the orb (spread along camera-right).
            const isCompleted = node.group.userData.completed;
            const stars = node.group.userData.stars || 0;
            for (let s = 0; s < 3; s += 1) {
                if (isCompleted && s < stars) {
                    const place = STAR_PLACEMENT[s];
                    matrix.copy(this.camera.matrixWorld);
                    matrix.setPosition(this._scratchIndicatorPos.copy(pos)
                        .addScaledVector(camRight, place.right * scale)
                        .addScaledVector(camUp, place.up * scale)
                        .addScaledVector(toCam, place.toward * scale));
                    const starScale = scale * 0.52;
                    matrix.scale(scaleVec.set(starScale, starScale, starScale));
                    this.starInstancedMesh.setMatrixAt(idx * 3 + s, matrix);
                } else {
                    this.starInstancedMesh.setMatrixAt(idx * 3 + s, matrix.makeScale(0, 0, 0));
                }
            }
        });

        this.lockInstancedMesh.instanceMatrix.needsUpdate = true;
        this.starInstancedMesh.instanceMatrix.needsUpdate = true;
    }

    /**
     * Dispose resources
     */
    dispose() {
        this.nodes.forEach((node) => {
            if (node.coreMaterial) node.coreMaterial.dispose();
            if (node.glowMaterial) node.glowMaterial.dispose();
            if (node.innerMesh?.material) node.innerMesh.material.dispose();
            this.scene.remove(node.group);
        });

        // Dispose shared geometries
        this.sharedInnerGeo?.dispose();
        this.sharedGlassGeo?.dispose();
        this.sharedGlowGeo?.dispose();

        // Dispose shared textures
        this.sharedLockTextures?.lockTexture?.dispose();
        this.sharedLockTextures?.lockGlowTexture?.dispose();
        this.sharedStarTexture?.dispose();
        this.sharedGlowTexture?.dispose();

        // Dispose instanced meshes
        if (this.glassInstancedMesh) {
            this.glassInstancedMesh.geometry.dispose();
            this.glassInstancedMesh.material.dispose();
            this.scene.remove(this.glassInstancedMesh);
        }
        if (this.glowInstancedMesh) {
            this.glowInstancedMesh.geometry.dispose();
            this.glowInstancedMesh.material.dispose();
            this.scene.remove(this.glowInstancedMesh);
        }

        if (this.lockInstancedMesh) {
            this.lockInstancedMesh.geometry.dispose();
            this.lockInstancedMesh.material.dispose();
            this.scene.remove(this.lockInstancedMesh);
        }
        if (this.starInstancedMesh) {
            this.starInstancedMesh.geometry.dispose();
            this.starInstancedMesh.material.dispose();
            this.scene.remove(this.starInstancedMesh);
        }

        if (this.particleSystem) {
            this.particleSystem.geometry.dispose();
            this.particleSystem.material.dispose();
            this.scene.remove(this.particleSystem);
        }
        // LEVER 1: free the instanced inner-core material + the shared theme-icon array
        // texture. The geometry is this.sharedInnerGeo (disposed above) — do NOT double-dispose.
        if (this.innerCoreMesh) {
            this.innerCoreMesh.material.dispose();
            this.scene.remove(this.innerCoreMesh);
            this.innerCoreMesh = null;
            this.innerCoreMaterial = null;
        }
        if (this.coreArrayTexture) {
            this.coreArrayTexture.dispose();
            this.coreArrayTexture = null;
        }
        this.themeTextureCache.forEach((texture) => texture.dispose());
        this.themeTextureCache.clear();
        if (this.fallbackIconTexture) {
            this.fallbackIconTexture.dispose();
            this.fallbackIconTexture = null;
        }
        this.cachedBasePositions.clear();
        this.nodes.clear();
    }
}

export default LevelNodeManager;
