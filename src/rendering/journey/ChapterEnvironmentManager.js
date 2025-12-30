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

/**
 * ChapterEnvironmentManager - Orchestrates chapter-specific visuals
 */
export class ChapterEnvironmentManager {
    /**
     * @param {THREE.Scene} scene - The main Three.js scene
     */
    constructor(scene) {
        this.scene = scene;

        // Container for all chapter environments
        this.environmentGroup = new THREE.Group();
        this.environmentGroup.name = 'chapter-environments';
        this.scene.add(this.environmentGroup);

        // Active environment references
        this.environments = new Map(); // chapterId -> { group, update }

        // Current state
        this.currentChapter = 1;
        this.cameraY = 0;
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
        this.updateVisibility(this.cameraY);

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
    updateVisibility(cameraY) {
        this.cameraY = cameraY;

        this.environments.forEach((env, chapterId) => {
            const { yStart, yEnd } = env.config;

            // Calculate visibility based on camera proximity to chapter bounds
            const chapterCenter = (yStart + yEnd) / 2;
            const chapterHeight = yEnd - yStart;

            // Full visibility when camera is within chapter bounds
            // Fade in/out over a transition zone
            const transitionZone = 5;

            let opacity = 0;

            if (cameraY >= yStart - transitionZone && cameraY <= yEnd + transitionZone) {
                if (cameraY < yStart) {
                    // Fading in from below
                    opacity = 1 - (yStart - cameraY) / transitionZone;
                } else if (cameraY > yEnd) {
                    // Fading out above
                    opacity = 1 - (cameraY - yEnd) / transitionZone;
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
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(mat => {
                        if (mat.uniforms?.uOpacity) {
                            mat.uniforms.uOpacity.value = opacity;
                        } else if (mat.opacity !== undefined) {
                            mat.opacity *= opacity;
                        }
                    });
                } else {
                    if (child.material.uniforms?.uOpacity) {
                        child.material.uniforms.uOpacity.value = opacity;
                    }
                    // Note: We don't modify base opacity to avoid compounding issues
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
     */
    update(delta) {
        this.time += delta;

        // Update each visible environment
        this.environments.forEach((env) => {
            if (env.group.visible && env.update) {
                env.update(env.group, delta, this.time);
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
