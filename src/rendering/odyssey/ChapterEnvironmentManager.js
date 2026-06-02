/**
 * @fileoverview ChapterEnvironmentManager - Manages themed visual environments
 *
 * Controls chapter-specific 3D backgrounds that change based on camera position
 * and player progress. Handles smooth transitions between chapter atmospheres.
 *
 * PERFORMANCE: Uses dynamic imports so chapter environments are loaded on-demand
 * instead of all at startup. Only the player's current chapter + neighbors are
 * loaded eagerly; remaining chapters load in background chunks.
 */

import * as THREE from 'three';
import {
    CHAPTER_CONFIGS,
    DEFAULT_BOARD_TRANSITION,
} from '../../core/odyssey/data/chapters.js';
import { ODYSSEY_PATH_DATA } from './path-data.js';

/**
 * Dynamic chapter module map — each entry returns a Promise that loads the module
 * only when requested. This avoids bundling all 6 heavy shader/geometry chapters
 * into the initial load.
 */
const CHAPTER_MODULE_LOADERS = {
    1: () => import('./chapter-environments/earth-core.js'),
    2: () => import('./chapter-environments/deep-ocean.js'),
    3: () => import('./chapter-environments/surface-world.js'),
    4: () => import('./chapter-environments/mountain-peaks.js'),
    5: () => import('./chapter-environments/sky-drift.js'),
    6: () => import('./chapter-environments/cosmic-expanse.js'),
    7: () => import('./chapter-environments/black-hole-transcendence.js'),
    8: () => import('./chapter-environments/urban-dreams.js'),
};

/**
 * Maps chapter IDs to the export names used in each module.
 * Pattern: CONFIG_NAME, CREATE_FN_NAME, UPDATE_FN_NAME
 */
const CHAPTER_EXPORT_NAMES = {
    1: {
        config: 'EARTH_CORE_CONFIG',
        create: 'createEarthCoreEnvironment',
        update: 'updateEarthCoreEnvironment',
    },
    2: {
        config: 'DEEP_OCEAN_CONFIG',
        create: 'createDeepOceanEnvironment',
        update: 'updateDeepOceanEnvironment',
    },
    3: {
        config: 'SURFACE_WORLD_CONFIG',
        create: 'createSurfaceWorldEnvironment',
        update: 'updateSurfaceWorldEnvironment',
    },
    4: {
        config: 'MOUNTAIN_PEAKS_CONFIG',
        create: 'createMountainPeaksEnvironment',
        update: 'updateMountainPeaksEnvironment',
    },
    5: {
        config: 'SKY_DRIFT_CONFIG',
        create: 'createSkyDriftEnvironment',
        update: 'updateSkyDriftEnvironment',
    },
    6: {
        config: 'COSMIC_EXPANSE_CONFIG',
        create: 'createCosmicExpanseEnvironment',
        update: 'updateCosmicExpanseEnvironment',
    },
    7: {
        config: 'BLACK_HOLE_TRANSCENDENCE_CONFIG',
        create: 'createBlackHoleTranscendenceEnvironment',
        update: 'updateBlackHoleTranscendenceEnvironment',
    },
    8: {
        config: 'URBAN_DREAMS_CONFIG',
        create: 'createUrbanDreamsEnvironment',
        update: 'updateUrbanDreamsEnvironment',
    },
};

const CHAPTER_POSITIONS = ODYSSEY_PATH_DATA.chapterPositions || [];
const CHAPTER_ENVIRONMENTS_BY_ID = new Map(
    CHAPTER_CONFIGS
        .filter((chapter) => chapter?.environment)
        .map((chapter) => [chapter.id, chapter.environment]),
);

// Cache for loaded modules so we don't re-import
const _loadedModules = new Map();

/**
 * Dynamically load a chapter module (cached).
 * @param {number} chapterId
 * @returns {Promise<{config: Object, create: Function, update: Function}>}
 */
async function loadChapterModule(chapterId) {
    if (_loadedModules.has(chapterId)) {
        return _loadedModules.get(chapterId);
    }

    const loader = CHAPTER_MODULE_LOADERS[chapterId];
    if (!loader) return null;

    const mod = await loader();
    const names = CHAPTER_EXPORT_NAMES[chapterId];

    const result = {
        config: mod[names.config],
        create: mod[names.create],
        update: mod[names.update],
    };

    _loadedModules.set(chapterId, result);
    return result;
}

const OPACITY_APPLY_EPSILON = 0.01;

function smootherstep01(value) {
    const t = THREE.MathUtils.clamp(value, 0, 1);
    return t * t * t * (t * (t * 6 - 15) + 10);
}

export function getChapterBoardTransition(chapterId, chapterConfigs = CHAPTER_CONFIGS) {
    const chapter = chapterConfigs.find((entry) => entry.id === chapterId);
    return {
        ...DEFAULT_BOARD_TRANSITION,
        ...(chapter?.boardTransition || {}),
    };
}

export function resolveChapterBlendState(
    progress,
    chapterConfigs = CHAPTER_CONFIGS,
    chapterPositions = CHAPTER_POSITIONS,
) {
    const clampedProgress = THREE.MathUtils.clamp(progress ?? 0, 0, 1);
    const weights = {};
    const chapterCount = chapterConfigs.length;

    for (let chapterId = 1; chapterId <= chapterCount; chapterId += 1) {
        weights[chapterId] = 0;
    }

    for (let chapterId = 1; chapterId < chapterCount; chapterId += 1) {
        const boundaryPosition = chapterPositions[chapterId];
        if (!Number.isFinite(boundaryPosition)) continue;

        const transition = getChapterBoardTransition(chapterId, chapterConfigs);
        const seamWidth = Math.max(0.001, transition.seamWidth || DEFAULT_BOARD_TRANSITION.seamWidth);
        const seamStart = boundaryPosition - seamWidth;
        const seamEnd = boundaryPosition + seamWidth;

        if (clampedProgress < seamStart || clampedProgress > seamEnd) {
            continue;
        }

        const seamProgress = smootherstep01((clampedProgress - seamStart) / (seamEnd - seamStart));
        weights[chapterId] = 1 - seamProgress;
        weights[chapterId + 1] = seamProgress;

        return {
            activeChapter: seamProgress >= 0.5 ? chapterId + 1 : chapterId,
            sourceChapter: chapterId,
            targetChapter: chapterId + 1,
            seamProgress,
            inSeam: true,
            boundaryId: `${chapterId}-${chapterId + 1}`,
            boundaryPosition,
            seamStart,
            seamEnd,
            transition,
            weights,
        };
    }

    let activeChapter = 1;
    for (let chapterId = 1; chapterId <= chapterCount; chapterId += 1) {
        const start = chapterPositions[chapterId - 1];
        const end = chapterPositions[chapterId] ?? 1;
        if (clampedProgress >= start && clampedProgress <= end) {
            activeChapter = chapterId;
            break;
        }
    }

    weights[activeChapter] = 1;
    return {
        activeChapter,
        sourceChapter: activeChapter,
        targetChapter: activeChapter,
        seamProgress: 0,
        inSeam: false,
        boundaryId: null,
        boundaryPosition: null,
        seamStart: null,
        seamEnd: null,
        transition: getChapterBoardTransition(activeChapter, chapterConfigs),
        weights,
    };
}

/**
 * ChapterEnvironmentManager - Orchestrates chapter-specific visuals
 */
export class ChapterEnvironmentManager {
    /**
     * @param {THREE.Scene} scene - The main Three.js scene
     */
    /**
     * @param {THREE.Scene} scene - The main Three.js scene
     * @param {THREE.WebGLRenderer} renderer - The renderer (for background color)
     */
    constructor(scene, renderer = null, options = {}) {
        this.scene = scene;
        this.renderer = renderer;
        this.chapterPositions = Array.isArray(options.chapterPositions) && options.chapterPositions.length >= 2
            ? [...options.chapterPositions]
            : [...CHAPTER_POSITIONS];

        // Container for all chapter environments
        this.environmentGroup = new THREE.Group();
        this.environmentGroup.name = 'chapter-environments';
        this.scene.add(this.environmentGroup);

        // Active environment references
        this.environments = new Map(); // chapterId -> { group, update }
        this.ambientLights = new Set();
        this.chapterEnvironmentById = CHAPTER_ENVIRONMENTS_BY_ID;

        // Current state
        this.currentChapter = 1;
        this.cameraY = 0;
        this.cameraProgress = 0;
        this.time = 0;

        // Transition state
        this.isTransitioning = false;
        this.transitionProgress = 0;
        this.transitionDuration = 1500;
        this.transitionFrom = null;
        this.transitionTo = null;

        // Chapter change callback (for camera FOV pulse integration)
        this.onChapterChangeCallback = null;

        // When true, OdysseyAtmosphere owns fog/clear/ambient (P2). We still run
        // chapter-change detection here (for the FOV pulse) but skip the visual writes.
        this.atmosphereOwned = false;

        // Quality settings
        this.qualitySettings = {
            particleCount: 500,
        };

        // Scratch values to avoid per-frame allocations in global blending.
        this._skyColorScratch = new THREE.Color();
        this._fogColorScratch = new THREE.Color();
        this._ambientColorScratch = new THREE.Color();
        this._blendColorScratch = new THREE.Color();
        this._resolvedBlendState = resolveChapterBlendState(0, CHAPTER_CONFIGS, this.chapterPositions);

        console.log('[ChapterEnvironmentManager] Created');
    }

    /**
     * Set callback for chapter change events
     * @param {Function} callback - Function(chapterId) called when chapter changes
     */
    setOnChapterChange(callback) {
        this.onChapterChangeCallback = callback;
    }

    /**
     * When owned, OdysseyAtmosphere drives fog/clear/ambient; updateGlobalEnvironment
     * keeps detecting chapter changes (FOV pulse) but skips its own visual writes.
     * @param {boolean} owned
     */
    setAtmosphereOwned(owned) {
        this.atmosphereOwned = !!owned;
    }

    /**
     * Register an ambient light for fast global updates.
     * @param {THREE.AmbientLight} light
     */
    registerAmbientLight(light) {
        if (!light?.isAmbientLight) return;
        this.ambientLights.add(light);
    }

    /**
     * Build one-time opacity targets for a chapter environment.
     * @param {THREE.Group} group
     * @returns {{uniformTargets: Object[], materialTargets: THREE.Material[]}}
     */
    _collectOpacityTargets(group) {
        const uniformTargets = [];
        const materialTargets = [];

        const seenUniforms = new Set();
        const seenMaterials = new Set();

        const collectMaterial = (material) => {
            if (!material || seenMaterials.has(material)) return;
            seenMaterials.add(material);

            const opacityUniform = material.uniforms?.uOpacity;
            if (opacityUniform && typeof opacityUniform.value === 'number') {
                if (!seenUniforms.has(opacityUniform)) {
                    seenUniforms.add(opacityUniform);
                    uniformTargets.push(opacityUniform);
                }
                return;
            }

            if (typeof material.opacity === 'number') {
                if (material.userData.baseOpacity === undefined) {
                    material.userData.baseOpacity = material.opacity;
                    material.userData.baseTransparent = material.transparent;
                    material.userData.lastTransparent = material.transparent;
                }
                materialTargets.push(material);
            }
        };

        group.traverse((child) => {
            if (child.isAmbientLight) {
                this.registerAmbientLight(child);
            }

            if (!child.material) return;
            if (Array.isArray(child.material)) {
                child.material.forEach(collectMaterial);
            } else {
                collectMaterial(child.material);
            }
        });

        return { uniformTargets, materialTargets };
    }

    /**
     * Initialize environments for specified chapters
     * @param {number[]} chapterIds - Array of chapter IDs to create
     * @param {Object} options - Quality options
     */
    async initialize(chapterIds = [1, 2], options = {}) {
        this.qualitySettings = { ...this.qualitySettings, ...options };

        console.log('[ChapterEnvironmentManager] Initializing chapters:', chapterIds);

        await Promise.all(chapterIds.map((chapterId) => this.createChapterEnvironment(chapterId)));

        // Set initial visibility
        this.updateVisibility(this.cameraProgress, { mode: 'progress' });

        console.log('[ChapterEnvironmentManager] Initialized', this.environments.size, 'environments');
    }

    /**
     * Create a single chapter's environment (loads module dynamically)
     * @param {number} chapterId
     */
    async createChapterEnvironment(chapterId) {
        // Skip if already loaded
        if (this.environments.has(chapterId)) {
            return this.environments.get(chapterId).group;
        }

        const def = await loadChapterModule(chapterId);

        if (!def) {
            console.warn(`[ChapterEnvironmentManager] No module for chapter ${chapterId}`);
            return null;
        }

        // Create the environment group
        const group = def.create(this.qualitySettings);
        group.visible = false; // Start hidden

        this.environmentGroup.add(group);

        const opacityTargets = this._collectOpacityTargets(group);

        this.environments.set(chapterId, {
            group,
            update: def.update,
            config: def.config,
            opacityTargets,
            lastOpacity: null,
            lastVisible: false,
            prewarmed: false,
        });

        console.log(`[ChapterEnvironmentManager] Created chapter ${chapterId} environment`);
        return group;
    }

    /**
     * Load remaining chapters in background without blocking the main thread.
     * Uses requestIdleCallback (with setTimeout fallback) to spread the work
     * across idle frames.
     * @param {number[]} alreadyLoaded - Chapter IDs that are already loaded
     * @param {Object} options
     * @param {Function} [options.canRunTask] - Returns true if it is safe to run heavy work
     * @param {Function} [options.onEnvironmentCreated] - Hook run after each environment loads
     */
    loadChaptersInBackground(alreadyLoaded = [], options = {}) {
        const allChapterIds = Object.keys(CHAPTER_MODULE_LOADERS).map(Number);
        const remaining = allChapterIds.filter((id) => !alreadyLoaded.includes(id));
        const canRunTask = typeof options.canRunTask === 'function'
            ? options.canRunTask
            : () => true;
        const onEnvironmentCreated = typeof options.onEnvironmentCreated === 'function'
            ? options.onEnvironmentCreated
            : null;

        if (remaining.length === 0) return;

        console.log('[ChapterEnvironmentManager] Background loading chapters:', remaining);

        const scheduleNext = (typeof requestIdleCallback === 'function')
            ? (fn) => requestIdleCallback(fn, { timeout: 3000 })
            : (fn) => setTimeout(fn, 200);

        let index = 0;
        const loadNext = () => {
            if (index >= remaining.length) {
                console.log('[ChapterEnvironmentManager] All chapters loaded in background');
                return;
            }

            if (!canRunTask()) {
                scheduleNext(loadNext);
                return;
            }

            const chapterId = remaining[index++];
            this.createChapterEnvironment(chapterId).then(async () => {
                // Update visibility after loading so the new environment shows if camera is there
                this.updateVisibility(this.cameraProgress, { mode: 'progress' });
                if (onEnvironmentCreated) {
                    await onEnvironmentCreated(chapterId);
                }
                scheduleNext(loadNext);
            }).catch((err) => {
                console.warn(`[ChapterEnvironmentManager] Background load failed for chapter ${chapterId}:`, err);
                scheduleNext(loadNext);
            });
        };

        // Start background loading after a brief delay to let the initial render settle
        setTimeout(() => scheduleNext(loadNext), 500);
    }

    /**
     * Update environment visibility based on camera Y position
     * @param {number} cameraY - Current camera Y position
     */
    updateVisibility(position, options = {}) {
        const mode = options.mode || 'y';

        if (mode === 'progress') {
            this.cameraProgress = THREE.MathUtils.clamp(position ?? 0, 0, 1);
            this._resolvedBlendState = resolveChapterBlendState(
                this.cameraProgress,
                CHAPTER_CONFIGS,
                this.chapterPositions,
            );
        } else {
            this.cameraY = position ?? 0;
        }

        this.environments.forEach((env, chapterId) => {
            const opacity = mode === 'progress'
                ? THREE.MathUtils.clamp(this._resolvedBlendState.weights?.[chapterId] || 0, 0, 1)
                : THREE.MathUtils.clamp(
                    env.group.position.y >= (this.cameraY ?? 0) ? 1 : 0,
                    0,
                    1,
                );
            const isVisible = opacity > 0;
            env.group.visible = isVisible;

            const visibilityChanged = env.lastVisible !== isVisible;
            const opacityDelta = env.lastOpacity === null
                ? Infinity
                : Math.abs(opacity - env.lastOpacity);
            const shouldApplyOpacity = visibilityChanged
                || opacityDelta >= OPACITY_APPLY_EPSILON
                || (opacity > 0 && opacity < 1)
                || (opacity === 1 && env.lastOpacity !== 1);

            if (isVisible && shouldApplyOpacity) {
                this.setGroupOpacity(env.opacityTargets, opacity);
            }

            env.lastOpacity = opacity;
            env.lastVisible = isVisible;
        });
    }

    getBlendState(progress = this.cameraProgress) {
        return resolveChapterBlendState(progress, CHAPTER_CONFIGS, this.chapterPositions);
    }

    setChapterPositions(chapterPositions = []) {
        if (!Array.isArray(chapterPositions) || chapterPositions.length < 2) {
            return;
        }

        this.chapterPositions = chapterPositions.filter((position) => Number.isFinite(position));
        this._resolvedBlendState = resolveChapterBlendState(
            this.cameraProgress,
            CHAPTER_CONFIGS,
            this.chapterPositions,
        );
    }

    getBoundaryTransition(boundaryIdOrChapterId) {
        if (typeof boundaryIdOrChapterId === 'string') {
            const sourceChapter = Number.parseInt(boundaryIdOrChapterId.split('-')[0], 10);
            return getChapterBoardTransition(sourceChapter);
        }
        return getChapterBoardTransition(boundaryIdOrChapterId);
    }

    /**
     * Set opacity for cached shader/material targets
     * @param {{uniformTargets: Object[], materialTargets: THREE.Material[]}} opacityTargets
     * @param {number} opacity
     */
    setGroupOpacity(opacityTargets, opacity) {
        if (!opacityTargets) return;

        const clampedOpacity = THREE.MathUtils.clamp(opacity, 0, 1);

        for (const uniform of opacityTargets.uniformTargets) {
            // Preserve the manager-controlled value so chapter-local effects
            // can layer their own opacity without compounding over frames.
            uniform.__odysseyBaseOpacity = clampedOpacity;
            uniform.value = clampedOpacity;
        }

        for (const material of opacityTargets.materialTargets) {
            if (material.userData.baseOpacity === undefined) {
                material.userData.baseOpacity = material.opacity;
                material.userData.baseTransparent = material.transparent;
                material.userData.lastTransparent = material.transparent;
            }

            material.opacity = material.userData.baseOpacity * clampedOpacity;

            if (clampedOpacity < 1) {
                material.transparent = true;
            } else {
                // Restore original transparency state when fully opaque
                material.transparent = material.userData.baseTransparent;
            }

            // Update material needsUpdate if transparency changed
            if (material.transparent !== material.userData.lastTransparent) {
                material.needsUpdate = true;
                material.userData.lastTransparent = material.transparent;
            }
        }
    }

    /**
     * Trigger animated transition to a specific chapter
     * @param {number} chapterId - Target chapter
     * @param {number} duration - Transition duration in ms
     */
    transitionToChapter(chapterId, duration = 1500) {
        if (chapterId === this.currentChapter) return;
        if (!this.environments.has(chapterId)) {
            console.warn(`[ChapterEnvironmentManager] Cannot transition to unknown chapter ${chapterId}`);
            return;
        }

        this.isTransitioning = true;
        this.transitionProgress = 0;
        this.transitionDuration = duration;
        this.transitionFrom = this.currentChapter;
        this.transitionTo = chapterId;

        console.log(`[ChapterEnvironmentManager] Starting transition: Ch${this.transitionFrom} -> Ch${chapterId}`);
    }

    /**
     * Get the current chapter based on camera position
     * @returns {number} Current chapter ID
     */
    getChapterAtPosition(y) {
        for (const [chapterId, env] of this.environments) {
            const { yStart, yEnd } = env.config;
            if (y >= yStart && y <= yEnd) {
                return chapterId;
            }
        }
        return 1; // Default to first chapter
    }

    /**
     * Update all environment animations
     * @param {number} delta - Delta time in seconds
     * @param {THREE.Camera} camera - Camera for position-based effects
     * @param {number|null} cameraProgress - Current Odyssey progress for path-anchored effects
     */
    update(delta, camera = null, cameraProgress = null) {
        this.time += delta;

        // Update each visible environment
        this.environments.forEach((env) => {
            if (env.group.visible && env.update) {
                env.update(env.group, delta, this.time, camera, cameraProgress);
            }
        });

        // Handle transition animation
        if (this.isTransitioning) {
            this.transitionProgress += (delta * 1000) / this.transitionDuration;

            if (this.transitionProgress >= 1) {
                this.transitionProgress = 1;
                this.isTransitioning = false;
                this.currentChapter = this.transitionTo;
                console.log(`[ChapterEnvironmentManager] Transition complete to chapter ${this.currentChapter}`);
            }
        }
    }

    /**
     * Update global environment (fog, background) based on camera progress
     * @param {number} progress - Camera progress (0-1)
     */
    updateGlobalEnvironment(progress) {
        const blendState = resolveChapterBlendState(progress, CHAPTER_CONFIGS, this.chapterPositions);
        const currentChapterId = blendState.sourceChapter;
        const nextChapterId = blendState.targetChapter;
        const t = blendState.seamProgress;

        // ═══════════════════════════════════════════════════════════════════
        // Chapter Change Detection - Trigger callback for FOV pulse
        // ═══════════════════════════════════════════════════════════════════
        if (blendState.activeChapter !== this.currentChapter) {
            const previousChapter = this.currentChapter;
            this.currentChapter = blendState.activeChapter;

            console.log(`[ChapterEnvironmentManager] Chapter changed: ${previousChapter} → ${this.currentChapter}`);

            // Notify camera controller (for FOV pulse and other effects)
            if (this.onChapterChangeCallback) {
                this.onChapterChangeCallback(this.currentChapter, previousChapter);
            }
        }

        // P2: when OdysseyAtmosphere owns the global look, it drives fog/clear/ambient
        // from director state. We still ran chapter-change detection above (FOV pulse).
        if (this.atmosphereOwned) return;

        const currentConfig = this.chapterEnvironmentById.get(currentChapterId);
        const nextConfig = this.chapterEnvironmentById.get(nextChapterId);

        if (!currentConfig) return;

        const {
            skyColor: currentSkyColor,
            fogColor: currentFogColor,
            ambientLight: currentAmbientLight,
            fogDensity: currentFogDensity,
            ambientIntensity: currentAmbientIntensity,
        } = currentConfig;

        const skyColor = this._skyColorScratch.set(currentSkyColor);
        const fogColor = this._fogColorScratch.set(currentFogColor);
        const ambientLight = this._ambientColorScratch.set(currentAmbientLight);
        let fogDensity = currentFogDensity;
        let ambientIntensity = currentAmbientIntensity;

        if (nextConfig && nextConfig !== currentConfig) {
            const {
                skyColor: nextSkyColor,
                fogColor: nextFogColor,
                ambientLight: nextAmbientLight,
                fogDensity: nextFogDensity,
                ambientIntensity: nextAmbientIntensity,
            } = nextConfig;
            const blend = THREE.MathUtils.clamp(t, 0, 1);

            this._blendColorScratch.set(nextSkyColor);
            skyColor.lerp(this._blendColorScratch, blend);

            this._blendColorScratch.set(nextFogColor);
            fogColor.lerp(this._blendColorScratch, blend);

            this._blendColorScratch.set(nextAmbientLight);
            ambientLight.lerp(this._blendColorScratch, blend);

            fogDensity = THREE.MathUtils.lerp(currentFogDensity, nextFogDensity, blend);
            ambientIntensity = THREE.MathUtils.lerp(
                currentAmbientIntensity,
                nextAmbientIntensity,
                blend,
            );
        }

        // Apply to scene
        if (this.scene.fog instanceof THREE.FogExp2) {
            this.scene.fog.color.copy(fogColor);
            this.scene.fog.density = fogDensity;
        } else {
            this.scene.fog = new THREE.FogExp2(fogColor, fogDensity);
        }

        // Apply background color if renderer is available
        if (this.renderer) {
            this.renderer.setClearColor(skyColor, 1);
        }

        // Update cached ambient lights directly (avoid per-frame scene traversal).
        for (const light of this.ambientLights) {
            if (!light?.isAmbientLight || !light.parent) {
                this.ambientLights.delete(light);
                continue;
            }
            light.color.copy(ambientLight);
            light.intensity = ambientIntensity;
        }
    }

    /**
     * Dispose of all environments
     */
    dispose() {
        this.environments.forEach((env) => {
            env.group.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach((m) => m.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            });
            this.environmentGroup.remove(env.group);
        });

        this.environments.clear();
        this.ambientLights.clear();
        this.scene.remove(this.environmentGroup);

        console.log('[ChapterEnvironmentManager] Disposed');
    }
}

export default ChapterEnvironmentManager;
