/**
 * @fileoverview ChapterEnvironmentManager - Manages themed visual environments
 * 
 * Controls chapter-specific 3D backgrounds that change based on camera position
 * and player progress. Handles smooth transitions between chapter atmospheres.
 */

import * as THREE from 'three';
import {
    EARTH_CORE_CONFIG,
    createEarthCoreEnvironment,
    updateEarthCoreEnvironment,
    DEEP_OCEAN_CONFIG,
    createDeepOceanEnvironment,
    updateDeepOceanEnvironment,
    SURFACE_WORLD_CONFIG,
    createSurfaceWorldEnvironment,
    updateSurfaceWorldEnvironment,
    MOUNTAIN_PEAKS_CONFIG,
    createMountainPeaksEnvironment,
    updateMountainPeaksEnvironment,
    SKY_DRIFT_CONFIG,
    createSkyDriftEnvironment,
    updateSkyDriftEnvironment,
    COSMIC_EXPANSE_CONFIG,
    createCosmicExpanseEnvironment,
    updateCosmicExpanseEnvironment,
} from './chapter-environments/index.js';
import { CHAPTER_CONFIGS } from '../../core/journey/data/chapters.js';
import { JOURNEY_PATH_DATA } from './path-data.js';

/**
 * Chapter environment definitions
 */
const CHAPTER_DEFS = [
    {
        id: 1,
        config: EARTH_CORE_CONFIG,
        create: createEarthCoreEnvironment,
        update: updateEarthCoreEnvironment,
    },
    {
        id: 2,
        config: DEEP_OCEAN_CONFIG,
        create: createDeepOceanEnvironment,
        update: updateDeepOceanEnvironment,
    },
    {
        id: 3,
        config: SURFACE_WORLD_CONFIG,
        create: createSurfaceWorldEnvironment,
        update: updateSurfaceWorldEnvironment,
    },
    {
        id: 4,
        config: MOUNTAIN_PEAKS_CONFIG,
        create: createMountainPeaksEnvironment,
        update: updateMountainPeaksEnvironment,
    },
    {
        id: 5,
        config: SKY_DRIFT_CONFIG,
        create: createSkyDriftEnvironment,
        update: updateSkyDriftEnvironment,
    },
    {
        id: 6,
        config: COSMIC_EXPANSE_CONFIG,
        create: createCosmicExpanseEnvironment,
        update: updateCosmicExpanseEnvironment,
    },
];

const DEFAULT_PATH_TRANSITION_ZONE = 0.02;

function getChapterPathRange(chapterId) {
    const positions = JOURNEY_PATH_DATA.chapterPositions || [];
    const start = positions[chapterId - 1];
    if (start === undefined) return null;
    const end = positions[chapterId] ?? 1;
    return { start, end };
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
    constructor(scene, renderer = null) {
        this.scene = scene;
        this.renderer = renderer;

        // Container for all chapter environments
        this.environmentGroup = new THREE.Group();
        this.environmentGroup.name = 'chapter-environments';
        this.scene.add(this.environmentGroup);

        // Active environment references
        this.environments = new Map(); // chapterId -> { group, update }

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

        // Quality settings
        this.qualitySettings = {
            particleCount: 500,
        };

        console.log('[ChapterEnvironmentManager] Created');
    }

    /**
     * Initialize environments for specified chapters
     * @param {number[]} chapterIds - Array of chapter IDs to create
     * @param {Object} options - Quality options
     */
    async initialize(chapterIds = [1, 2], options = {}) {
        this.qualitySettings = { ...this.qualitySettings, ...options };

        console.log('[ChapterEnvironmentManager] Initializing chapters:', chapterIds);

        for (const chapterId of chapterIds) {
            await this.createChapterEnvironment(chapterId);
        }

        // Set initial visibility
        this.updateVisibility(this.cameraProgress, { mode: 'progress' });

        console.log('[ChapterEnvironmentManager] Initialized', this.environments.size, 'environments');
    }

    /**
     * Create a single chapter's environment
     * @param {number} chapterId
     */
    async createChapterEnvironment(chapterId) {
        const def = CHAPTER_DEFS.find(d => d.id === chapterId);

        if (!def) {
            console.warn(`[ChapterEnvironmentManager] No definition for chapter ${chapterId}`);
            return;
        }

        // Create the environment group
        const group = def.create(this.qualitySettings);
        group.visible = false; // Start hidden

        this.environmentGroup.add(group);

        this.environments.set(chapterId, {
            group,
            update: def.update,
            config: def.config,
        });

        console.log(`[ChapterEnvironmentManager] Created chapter ${chapterId} environment`);
    }

    /**
     * Update environment visibility based on camera Y position
     * @param {number} cameraY - Current camera Y position
     */
    updateVisibility(position, options = {}) {
        const mode = options.mode || 'y';
        const transitionZone = options.transitionZone
            ?? (mode === 'progress' ? DEFAULT_PATH_TRANSITION_ZONE : 5);

        if (mode === 'progress') {
            this.cameraProgress = THREE.MathUtils.clamp(position ?? 0, 0, 1);
        } else {
            this.cameraY = position ?? 0;
        }

        this.environments.forEach((env, chapterId) => {
            const range = mode === 'progress'
                ? getChapterPathRange(chapterId)
                : { start: env.config.yStart, end: env.config.yEnd };

            if (!range) {
                env.group.visible = false;
                return;
            }

            // Allow extending the environment beyond the standard chapter end
            // This is useful for environments that should persist into the next chapter (like Aurora)
            if (mode === 'progress' && env.config.endProgress) {
                range.end = env.config.endProgress;
            }

            const { start, end } = range;
            const value = mode === 'progress' ? this.cameraProgress : this.cameraY;
            const envTransitionZone = env.config.transitionZone ?? transitionZone;

            let opacity = 0;

            if (value >= start - envTransitionZone && value <= end + envTransitionZone) {
                if (value < start) {
                    // Fading in from below
                    opacity = 1 - (start - value) / envTransitionZone;
                } else if (value > end) {
                    // Fading out above
                    opacity = 1 - (value - end) / envTransitionZone;
                } else {
                    // Fully visible
                    opacity = 1;
                }
            }

            opacity = THREE.MathUtils.clamp(opacity, 0, 1);

            // Show/hide based on opacity
            env.group.visible = opacity > 0;

            // Apply opacity to all materials
            if (opacity > 0 && opacity < 1) {
                this.setGroupOpacity(env.group, opacity);
            } else if (opacity >= 1) {
                this.setGroupOpacity(env.group, 1);
            }
        });
    }

    /**
     * Set opacity for all materials in a group
     * @param {THREE.Group} group
     * @param {number} opacity
     */
    setGroupOpacity(group, opacity) {
        group.traverse((child) => {
            const applyOpacity = (mat) => {
                if (mat.uniforms?.uOpacity) {
                    mat.uniforms.uOpacity.value = opacity;
                    return;
                }

                if (mat.opacity !== undefined) {
                    // Save initial state
                    if (mat.userData.baseOpacity === undefined) {
                        mat.userData.baseOpacity = mat.opacity;
                        mat.userData.baseTransparent = mat.transparent;
                    }

                    mat.opacity = mat.userData.baseOpacity * opacity;

                    if (opacity < 1) {
                        mat.transparent = true;
                    } else {
                        // Restore original transparency state when fully opaque
                        mat.transparent = mat.userData.baseTransparent;
                    }

                    // Update material needsUpdate if transparency changed
                    if (mat.transparent !== mat.userData.lastTransparent) {
                        mat.needsUpdate = true;
                        mat.userData.lastTransparent = mat.transparent;
                    }
                }
            };

            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(applyOpacity);
                } else {
                    applyOpacity(child.material);
                }
            }
        });
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
     */
    update(delta, camera = null) {
        this.time += delta;

        // Update each visible environment
        this.environments.forEach((env) => {
            if (env.group.visible && env.update) {
                env.update(env.group, delta, this.time, camera);
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
        // Find which chapters we are blending between
        const positions = JOURNEY_PATH_DATA.chapterPositions;

        let currentChapterId = 1;
        let nextChapterId = 1;
        let t = 0;

        for (let i = 0; i < positions.length; i++) {
            const start = positions[i];
            const end = positions[i + 1] ?? 1;

            if (progress >= start && progress <= end) {
                currentChapterId = i + 1;

                // Check if we are in a transition zone to next chapter
                // Transition starts at end - transitionZone
                // Or maybe we just interpolate completely between chapter centers?
                // Let's stick to the config environment settings

                // Simple interpolation:
                // If we are in the last 20% of the chapter, blend to next
                const chapterDuration = end - start;
                const localProgress = (progress - start) / chapterDuration;

                if (localProgress > 0.8 && (i + 1) < positions.length) {
                    nextChapterId = currentChapterId + 1;
                    t = (localProgress - 0.8) / 0.2; // 0 to 1
                } else {
                    nextChapterId = currentChapterId;
                    t = 0;
                }
                break;
            }
        }

        const currentConfig = CHAPTER_CONFIGS.find(c => c.id === currentChapterId)?.environment;
        const nextConfig = CHAPTER_CONFIGS.find(c => c.id === nextChapterId)?.environment;

        if (!currentConfig) return;

        // Helper to lerp colors
        const lerpColor = (c1, c2, alpha) => {
            const r = new THREE.Color(c1).lerp(new THREE.Color(c2), alpha);
            return r;
        };

        const targetEnv = nextConfig ? {
            skyColor: lerpColor(currentConfig.skyColor, nextConfig.skyColor, t),
            fogColor: lerpColor(currentConfig.fogColor, nextConfig.fogColor, t),
            fogDensity: THREE.MathUtils.lerp(currentConfig.fogDensity, nextConfig.fogDensity, t),
            ambientLight: lerpColor(currentConfig.ambientLight, nextConfig.ambientLight, t),
            ambientIntensity: THREE.MathUtils.lerp(currentConfig.ambientIntensity, nextConfig.ambientIntensity, t),
        } : {
            skyColor: new THREE.Color(currentConfig.skyColor),
            fogColor: new THREE.Color(currentConfig.fogColor),
            fogDensity: currentConfig.fogDensity,
            ambientLight: new THREE.Color(currentConfig.ambientLight),
            ambientIntensity: currentConfig.ambientIntensity,
        };

        // Apply to scene
        if (this.scene.fog instanceof THREE.FogExp2) {
            this.scene.fog.color.copy(targetEnv.fogColor);
            this.scene.fog.density = targetEnv.fogDensity;
        } else {
            this.scene.fog = new THREE.FogExp2(targetEnv.fogColor, targetEnv.fogDensity);
        }

        // Apply background color if renderer is available
        if (this.renderer) {
            this.renderer.setClearColor(targetEnv.skyColor, 1);
        }

        // Apply to ambient light if found in scene (assumed to be the first one found or we search by type)
        // We know we added one in JourneyBoardController, but let's try to find it or modify all
        this.scene.traverse((child) => {
            if (child.isAmbientLight) {
                child.color.copy(targetEnv.ambientLight);
                child.intensity = targetEnv.ambientIntensity;
            }
        });
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
                        child.material.forEach(m => m.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            });
            this.environmentGroup.remove(env.group);
        });

        this.environments.clear();
        this.scene.remove(this.environmentGroup);

        console.log('[ChapterEnvironmentManager] Disposed');
    }
}

export default ChapterEnvironmentManager;
