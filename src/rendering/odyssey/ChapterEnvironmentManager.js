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

import * as THREE from 'three/webgpu';
import {
    CHAPTER_CONFIGS,
    DEFAULT_BOARD_TRANSITION,
} from '../../core/odyssey/data/chapters.js';
import { ODYSSEY_PATH_DATA } from './path-data.js';
import {
    getChapterProfile,
    getChapterTransitionForChapter,
} from './chapter-environments/shared/chapter-profile.js';

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
        .map((chapter) => [chapter.id, getChapterProfile(chapter.id).atmosphere])
        .filter(([, atmosphere]) => atmosphere),
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

// ── Ecotone (overlap-band) transition tuning ────────────────────────────────────
// A6: replace the hard portal cut (chapter fades out → black/fogged void → next
// chapter fades in) with a real OVERLAP WINDOW where adjacent biomes are co-present.
// The window is derived per-boundary from the ADJACENT chapter spans so it scales
// with the layout (short chapters get a proportionally short overlap). ECOTONE_SPAN_
// FRACTION is the fraction of the *smaller* adjacent chapter span that the overlap
// reaches across on EACH side of the boundary (≈ the "last ~12% of N co-present with
// first ~12% of N+1" target). The window is clamped so neighbouring ecotones never
// collide and is always a strict superset of the narrow fog seamWidth.
// PERF (transition lag): the overlap window is the stretch where BOTH chapters +
// both corridor fields + the breach all render at once (the dominant per-seam cost,
// amplified by the always-on light rig). Tightened from 0.18/0.085 → 0.11/0.055 so the
// double-render stretch is ~35% shorter; the fog colour/density lerp + the per-seam
// carried-element ramps still bridge the boundary so it reads as a blend, not a cut.
const ECOTONE_SPAN_FRACTION = 0.11; // fraction of the smaller adjacent chapter span, per side
const ECOTONE_MAX_HALF_WIDTH = 0.055; // absolute arc-length cap per side (safety)
const ECOTONE_NEIGHBOUR_CLEARANCE = 0.45; // never reach past ~half-way to the next boundary

// ── B7 SEAM ACT-ARCS — per-boundary "carried element" + early-ignite ramps ──────────
// These complement the ecotone opacity crossfade (above) and the fog colour/density lerp
// (updateGlobalEnvironment) with a small set of TARGETED per-seam ramps the §4 transition
// table calls for. They are pure data-derived scalars (no per-frame allocation) applied to
// reachable env hooks (env-group opacity boost + group.userData scalar drivers the env /
// post can read). They are ADDITIVE: where no driver applies the legacy crossfade is used.
//
// 5->6 (the WORST seam): ignite Space's crisp starfield EARLY across the last ~8% of Sky so
//   that by Space-01 the black vacuum + sharp stars read immediately (no "pink soup in
//   space"). The fog itself dissolves via the widened 5->6 seamWidth (chapter-profile);
//   here we pull the Space (ch6) env opacity FORWARD so the stars are already up at the seam.
const SEAM_56_STAR_IGNITE_BAND = 0.08; // fraction of Sky's span before the boundary to pre-light Space
// 7->8 afterglow: the singularity's core glow "becomes" the first neon — pull the Urban
//   (ch8) env opacity slightly FORWARD into the tail of Black Hole so the neon city resolves
//   out of the BH afterglow rather than snapping in.
const SEAM_78_AFTERGLOW_BAND = 0.05; // fraction of BH's span before the boundary to pre-seed neon
// Journey end: over the last ~18% of the FINAL chapter (aligned with the urban finale crane
//   + spire ignition window) expose a graceful 0->1 end ramp on the finale env's userData
//   (consumed for the exposure bleed / beacon hold) so the journey EASES out — a slow bleed
//   to the luminous payoff, never a hard cut at progress=1.
const JOURNEY_END_BAND = 0.18;

// SEAM 5->6 COLOUR ("the color changes to darker space with a pop"). The fog/sky COLOUR is
// normally lerped only across the NARROW content seam (seamWidth 0.03), so the whole Sky
// violet -> Space near-black change is crammed into ~0.06 of progress and reads as a snap.
// For the 5->6 boundary ONLY we drive the COLOUR lerp over a WIDER, smootherstep'd window
// centred on the boundary — WITHOUT widening the ecotone/content seam (so no extra double-
// render cost; only the per-frame colour scalar changes). Density keeps its existing front-
// loaded evaporation; the wider window applies to colour + ambient only.
const SEAM_56_COLOUR_HALF_WIDTH = 0.07; // per-side progress window for the 5->6 colour lerp

function smootherstep01(value) {
    const t = THREE.MathUtils.clamp(value, 0, 1);
    return t * t * t * (t * (t * 6 - 15) + 10);
}

function smoothstep01(value) {
    const t = THREE.MathUtils.clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
}

/**
 * Resolve the half-width (arc-length, per side) of the ecotone overlap band centred on
 * the boundary between `chapterId` and `chapterId + 1`. Scales with the smaller adjacent
 * chapter span, is capped, kept clear of neighbouring boundaries, and is never narrower
 * than the configured fog seamWidth (so the content crossfade is a strict superset).
 */
function resolveEcotoneHalfWidth(chapterId, chapterPositions, seamWidth) {
    const boundaryPosition = chapterPositions[chapterId];
    const prevBoundary = chapterPositions[chapterId - 1] ?? 0;
    const nextBoundary = chapterPositions[chapterId + 1] ?? 1;
    if (!Number.isFinite(boundaryPosition)) return Math.max(0.001, seamWidth || 0.001);

    const spanBefore = boundaryPosition - prevBoundary;
    const spanAfter = nextBoundary - boundaryPosition;
    const smallerSpan = Math.max(0.001, Math.min(spanBefore, spanAfter));

    let halfWidth = smallerSpan * ECOTONE_SPAN_FRACTION;
    halfWidth = Math.min(halfWidth, ECOTONE_MAX_HALF_WIDTH);
    // Keep clear of the previous/next boundary so adjacent ecotones never overlap.
    halfWidth = Math.min(
        halfWidth,
        spanBefore * ECOTONE_NEIGHBOUR_CLEARANCE,
        spanAfter * ECOTONE_NEIGHBOUR_CLEARANCE,
    );
    // Always a superset of the fog seam so both biomes are co-present at least as wide
    // as the colour lerp.
    return Math.max(halfWidth, seamWidth || 0.001);
}

// QW7: per-chapter board transitions are static-per-chapterId (two object spreads each
// call in the original). resolveChapterBlendState / resolveEcotoneOverlap called this
// ~25-50× per resolve, ~2×/frame — the largest per-frame transient-alloc source. Cache
// the merged object ONCE per chapterId in a frozen table and return the cached instance.
// The returned object is frozen so callers can't mutate the shared cache; getBlendState
// consumers only read `.seamWidth`/etc. Misses (unknown chapterId) fall back to a freshly
// built object (still frozen) and are cached for next time.
const _chapterBoardTransitionCache = new Map();

export function getChapterBoardTransition(chapterId) {
    const cached = _chapterBoardTransitionCache.get(chapterId);
    if (cached) return cached;

    const transition = Object.freeze({
        ...DEFAULT_BOARD_TRANSITION,
        ...getChapterTransitionForChapter(chapterId),
    });
    _chapterBoardTransitionCache.set(chapterId, transition);
    return transition;
}

/**
 * A6: Compute the ECOTONE overlap weights for a progress value. Independent of the narrow
 * fog seam, this finds the boundary whose (wider) ecotone window contains `progress` and
 * derives two arc-length weights: wN = smoothstep(1→0) for the outgoing chapter and
 * wN1 = smoothstep(0→1) for the incoming chapter, so both biomes are visibly co-present
 * across the band rather than dipping to nothing between localized set pieces.
 *
 * Returns a per-chapter `weights` map and metadata, or `null` outside every ecotone.
 *
 * GC: accepts an optional preallocated `weightsScratch` map (zeroed here each call) so the
 * hot per-frame caller can avoid allocating a fresh `{}` every resolve. The map escapes in
 * the returned object (stored as `ecotoneWeights`), so each independent caller must supply
 * its OWN scratch — never share one map across two concurrently-live blend states. When no
 * scratch is given (default), a fresh object is allocated (backward-compatible).
 */
function resolveEcotoneOverlap(
    clampedProgress,
    chapterConfigs,
    chapterPositions,
    weightsScratch = null,
) {
    const chapterCount = chapterConfigs.length;

    for (let chapterId = 1; chapterId < chapterCount; chapterId += 1) {
        const boundaryPosition = chapterPositions[chapterId];
        if (!Number.isFinite(boundaryPosition)) continue;

        const transition = getChapterBoardTransition(chapterId);
        const seamWidth = Math.max(0.001, transition.seamWidth || DEFAULT_BOARD_TRANSITION.seamWidth);
        const halfWidth = resolveEcotoneHalfWidth(chapterId, chapterPositions, seamWidth);
        const start = boundaryPosition - halfWidth;
        const end = boundaryPosition + halfWidth;

        if (clampedProgress < start || clampedProgress > end) continue;

        // Linear position across the window → smoothstep both directions.
        const tRaw = THREE.MathUtils.clamp((clampedProgress - start) / (end - start), 0, 1);
        const wN1 = smoothstep01(tRaw); // incoming chapter rises 0→1
        const wN = smoothstep01(1 - tRaw); // outgoing chapter falls 1→0

        const weights = weightsScratch || {};
        for (let id = 1; id <= chapterCount; id += 1) weights[id] = 0;
        weights[chapterId] = wN;
        weights[chapterId + 1] = wN1;

        return {
            weights,
            boundaryId: `${chapterId}-${chapterId + 1}`,
            sourceChapter: chapterId,
            targetChapter: chapterId + 1,
            wN,
            wN1,
            t: tRaw,
            halfWidth,
            start,
            end,
        };
    }

    return null;
}

export function resolveChapterBlendState(
    progress,
    chapterConfigs = CHAPTER_CONFIGS,
    chapterPositions = CHAPTER_POSITIONS,
    scratch = null,
) {
    const clampedProgress = THREE.MathUtils.clamp(progress ?? 0, 0, 1);
    const chapterCount = chapterConfigs.length;
    // GC: the returned `weights` and `ecotoneWeights` maps escape (stored on the caller's
    // _resolvedBlendState and read across the frame). An optional `scratch` lets the hot
    // per-frame caller reuse two owned maps instead of allocating two fresh `{}` per call.
    // Two DISTINCT maps are required (weights vs ecotoneWeights are both live in the result).
    // Each independent caller must pass its OWN scratch — never share across live states.
    const weights = scratch?.weights || {};
    const ecotoneScratch = scratch?.ecotoneWeights || null;

    for (let chapterId = 1; chapterId <= chapterCount; chapterId += 1) {
        weights[chapterId] = 0;
    }

    // A6: the ecotone overlap is wider than the fog seam and is the source of truth for
    // the content/env-opacity crossfade (so both biomes are on screen together). It is
    // computed independently of `inSeam` and falls back to the narrow `weights` map below.
    const ecotone = resolveEcotoneOverlap(
        clampedProgress,
        chapterConfigs,
        chapterPositions,
        ecotoneScratch,
    );
    const ecotoneWeights = ecotone ? ecotone.weights : null;

    for (let chapterId = 1; chapterId < chapterCount; chapterId += 1) {
        const boundaryPosition = chapterPositions[chapterId];
        if (!Number.isFinite(boundaryPosition)) continue;

        const transition = getChapterBoardTransition(chapterId);
        const seamWidth = Math.max(0.001, transition.seamWidth || DEFAULT_BOARD_TRANSITION.seamWidth);
        const seamStart = boundaryPosition - seamWidth;
        const seamEnd = boundaryPosition + seamWidth;

        if (clampedProgress < seamStart || clampedProgress > seamEnd) {
            continue;
        }

        const rawSeamProgress = THREE.MathUtils.clamp(
            (clampedProgress - seamStart) / (seamEnd - seamStart),
            0,
            1,
        );
        const seamProgress = smootherstep01(rawSeamProgress);
        const seamPhase = THREE.MathUtils.clamp(
            (clampedProgress - boundaryPosition) / seamWidth,
            -1,
            1,
        );
        const seamEnvelope = Math.sin(rawSeamProgress * Math.PI);
        weights[chapterId] = 1 - seamProgress;
        weights[chapterId + 1] = seamProgress;

        return {
            activeChapter: seamProgress >= 0.5 ? chapterId + 1 : chapterId,
            sourceChapter: chapterId,
            targetChapter: chapterId + 1,
            seamProgress,
            rawSeamProgress,
            seamPhase,
            seamEnvelope,
            inSeam: true,
            boundaryId: `${chapterId}-${chapterId + 1}`,
            boundaryPosition,
            seamWidth,
            seamStart,
            seamEnd,
            transition,
            weights,
            ecotone,
            ecotoneWeights,
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
        rawSeamProgress: 0,
        seamPhase: 0,
        seamEnvelope: 0,
        inSeam: false,
        boundaryId: null,
        boundaryPosition: null,
        seamWidth: null,
        seamStart: null,
        seamEnd: null,
        transition: getChapterBoardTransition(activeChapter),
        weights,
        ecotone,
        ecotoneWeights,
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

        // QW4 — PERSISTENT LIGHT RIG. The dominant "buggy at transitions" hitch came from the
        // active LIGHT SET changing at every seam: toggling group.visible on a group that
        // contains lights removes those lights from the renderer's light collection, which
        // nulls LightsNode._lightNodes and forces customCacheKey to re-resolve EVERY lit
        // material (a multi-ms→100s-of-ms pipeline recompile right at the boundary).
        //
        // Fix: at chapter load we REPARENT each chapter's THREE.Light(s) into this single,
        // never-hidden rig (preserving world placement) and crossfade their INTENSITY by the
        // chapter blend weight instead. The active light SET is then constant for the whole
        // journey, so no seam recompile. Renderable meshes/particles stay .visible-toggled.
        // Per-chapter light COUNT cuts are handled elsewhere (QW9 etc.); this only changes
        // WHERE the lights live and HOW they fade, not how many there are.
        this.persistentLightRig = new THREE.Group();
        this.persistentLightRig.name = 'odyssey-persistent-light-rig';
        this.persistentLightRig.visible = true; // never hidden — keeps the light set constant
        this.environmentGroup.add(this.persistentLightRig);
        // Scratch matrix/vector reused when baking a reparented light's world placement.
        this._lightReparentMatrix = new THREE.Matrix4();
        this._lightReparentPos = new THREE.Vector3();
        this._lightReparentQuat = new THREE.Quaternion();
        this._lightReparentScale = new THREE.Vector3();

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

        // When true, OdysseyAtmosphere owns the dome/clear/ambient/light rig (P2).
        // Scene FOG (color + density) is ALWAYS owned here — the per-chapter
        // chapter-profile lerp is the single source of truth for fog so the camera
        // never crosses an uncoloured void. When owned we still skip the clear-color
        // and ambient writes (the atmosphere rig drives those) and run chapter-change
        // detection for the FOV pulse.
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
        // GC: owned weight maps reused by the instance's INTERNAL recompute paths
        // (constructor / setChapterPositions / the updateVisibility fallback). The public
        // getBlendState() still allocates fresh maps so its returned snapshot never aliases
        // a second consumer. Two distinct maps (weights + ecotoneWeights both live at once).
        this._blendStateScratch = { weights: {}, ecotoneWeights: {} };
        this._resolvedBlendState = resolveChapterBlendState(
            0,
            CHAPTER_CONFIGS,
            this.chapterPositions,
            this._blendStateScratch,
        );

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
     * When owned, OdysseyAtmosphere drives the dome/clear-color/ambient/light rig and
     * updateGlobalEnvironment skips those writes. Scene FOG (color + density) is always
     * driven here from the chapter-profile lerp regardless of ownership, so exactly one
     * place sets scene.fog per frame. Chapter-change detection (FOV pulse) always runs.
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
                    // QW5: record the authored transparent flag, then force transparent=true
                    // PERMANENTLY at build. The crossfade now drives ONLY material.opacity —
                    // it never flips .transparent mid-fade, so the cached pipeline is never
                    // invalidated (no needsUpdate=true recompile at the seam). One pipeline
                    // build happens here at construct time instead of a hitch per crossfade.
                    material.userData.baseTransparent = material.transparent;
                    material.userData.lastTransparent = material.transparent;
                    material.transparent = true;
                }
                materialTargets.push(material);
            }
        };

        group.traverse((child) => {
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
     * QW4 — reparent every THREE.Light in a freshly-built chapter group into the persistent
     * light rig so the active light SET never changes at a seam (no LightsNode cache-key churn,
     * no per-material recompile hitch). World placement is preserved by baking the light's
     * transform relative to the rig's parent (environmentGroup). The original chapter-group
     * userData references (e.g. lavaLight, accentLights) stay valid — it is the SAME Light
     * instance, only its parent changes — so each chapter's update() keeps animating its lights
     * by absolute intensity assignment; the crossfade is applied AFTER update() as a weight
     * multiply (see _applyLightCrossfade), which is non-compounding because chapter updates
     * rewrite intensity from scratch each frame.
     *
     * @param {THREE.Group} group chapter group (already added under environmentGroup)
     * @returns {Array<{light: THREE.Light, baseIntensity: number}>} rig-managed lights
     */
    _reparentChapterLights(group) {
        const rigLights = [];
        const lights = [];
        // Collect first; reparenting mutates the tree, so don't reparent mid-traverse.
        group.traverse((child) => {
            if (child.isLight) lights.push(child);
        });

        // Ensure world matrices are current so baked placement is accurate.
        this.environmentGroup.updateMatrixWorld(true);

        for (const light of lights) {
            const baseIntensity = light.intensity;
            // Bake the light's transform into the rig's local space: rigLocal =
            // inverse(rigParentWorld) * lightWorld. The rig sits at the origin under
            // environmentGroup, so this preserves the on-screen position/orientation.
            light.updateWorldMatrix(true, false);
            this._lightReparentMatrix
                .copy(this.persistentLightRig.matrixWorld)
                .invert()
                .multiply(light.matrixWorld);
            this._lightReparentMatrix.decompose(
                this._lightReparentPos,
                this._lightReparentQuat,
                this._lightReparentScale,
            );

            this.persistentLightRig.add(light); // detaches from chapter group
            light.position.copy(this._lightReparentPos);
            light.quaternion.copy(this._lightReparentQuat);
            light.scale.copy(this._lightReparentScale);

            // Remember the authored full-strength intensity so a light that its chapter
            // update never touches (static) can be reset to base each frame without drift.
            light.userData.rigBaseIntensity = baseIntensity;
            rigLights.push({ light, baseIntensity });
        }

        return rigLights;
    }

    /**
     * QW4 — apply the per-chapter blend weight to a chapter's rig lights. Run AFTER the
     * chapter's update() (which rewrites animated intensities from scratch) so the weight is
     * a clean multiply that never compounds. For a chapter whose update did NOT run this frame
     * (hidden / weight 0) the light is driven to 0 directly. Pure arithmetic, no allocation.
     *
     * @param {Array<{light: THREE.Light}>} rigLights
     * @param {number} weight 0..1 chapter blend weight
     * @param {boolean} updated whether the chapter's update() ran this frame
     */
    _applyLightCrossfade(rigLights, weight, updated) {
        if (!rigLights || rigLights.length === 0) return;
        const w = THREE.MathUtils.clamp(weight, 0, 1);
        for (const entry of rigLights) {
            const { light } = entry;
            // If the chapter didn't animate this frame, restore the authored base before
            // scaling so a static light scales from its full value (no per-frame drift).
            const fullStrength = updated
                ? light.intensity
                : (light.userData.rigBaseIntensity ?? entry.baseIntensity);
            light.intensity = fullStrength * w;
        }
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
        // QW4: pull this chapter's lights into the always-resident rig so the seam never
        // changes the active light set (no recompile hitch). Must run after the group is
        // parented under environmentGroup so the baked world placement is correct.
        const rigLights = this._reparentChapterLights(group);

        this.environments.set(chapterId, {
            group,
            update: def.update,
            config: def.config,
            opacityTargets,
            rigLights,
            lastOpacity: null,
            lastVisible: false,
            prewarmed: false,
        });

        // The chapter starts hidden → drive its rig lights to 0 so reparented lights don't
        // illuminate the scene before the chapter is on screen.
        this._applyLightCrossfade(rigLights, 0, false);

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
     * B7 — early-ignite opacity boost for a chapter near a seam where the §4 transition
     * calls for the INCOMING biome to read BEFORE the boundary (a carried element / early
     * reveal). Returns a 0..1 boost that is Math.max'd into the chapter's crossfade opacity
     * so the env never DIMS — it only appears earlier. Pure arithmetic, no allocation.
     *
     *  • ch6 Space — ignite the starfield across the last ~8% of Sky (5->6, the worst seam)
     *  • ch8 Urban — seed the neon city across the last ~5% of Black Hole (7->8 afterglow)
     *
     * @param {number} chapterId incoming chapter id
     * @param {number} progress current path progress (0..1)
     * @returns {number} early-ignite boost 0..1
     */
    _seamInBoostFor(chapterId, progress) {
        // Generic helper: ramp 0->1 as `progress` crosses the last `band` of the OUTGOING
        // chapter (chapterId-1) up to the boundary at chapterPositions[chapterId-1].
        const ramp = (band) => {
            const boundary = this.chapterPositions[chapterId - 1];
            const prevBoundary = this.chapterPositions[chapterId - 2] ?? 0;
            if (!Number.isFinite(boundary) || !Number.isFinite(prevBoundary)) return 0;
            const span = boundary - prevBoundary;
            if (span <= 0) return 0;
            const start = boundary - span * band;
            return smoothstep01((progress - start) / Math.max(1e-5, boundary - start));
        };

        if (chapterId === 6) return ramp(SEAM_56_STAR_IGNITE_BAND);
        if (chapterId === 8) return ramp(SEAM_78_AFTERGLOW_BAND);
        return 0;
    }

    /**
     * B7 — graceful journey-end ramp (0->1) over the last `JOURNEY_END_BAND` of the FINAL
     * chapter. Written onto the finale env group's userData so the urban env / post can hold
     * the beacon + bleed exposure (the §3 ch8 "graceful fade, not a hard cut"). No allocation.
     * @param {number} progress current path progress (0..1)
     */
    _applyJourneyEndDriver(progress) {
        const lastChapterId = this.chapterPositions.length - 1; // positions = [s1..sN, 1]
        const env = this.environments.get(lastChapterId);
        if (!env?.group) return;
        const end = this.chapterPositions[lastChapterId] ?? 1; // == 1 (journey end)
        const prevBoundary = this.chapterPositions[lastChapterId - 1] ?? (end - JOURNEY_END_BAND);
        const span = Math.max(1e-5, end - prevBoundary);
        const start = end - span * JOURNEY_END_BAND;
        const journeyEnd = smoothstep01((progress - start) / Math.max(1e-5, end - start));
        env.group.userData.journeyEnd = journeyEnd;
    }

    /**
     * Update environment visibility based on camera Y position
     * @param {number} cameraY - Current camera Y position
     */
    updateVisibility(position, options = {}) {
        const mode = options.mode || 'y';

        if (mode === 'progress') {
            this.cameraProgress = THREE.MathUtils.clamp(position ?? 0, 0, 1);
            this._resolvedBlendState = options.blendState || resolveChapterBlendState(
                this.cameraProgress,
                CHAPTER_CONFIGS,
                this.chapterPositions,
                this._blendStateScratch,
            );
        } else {
            this.cameraY = position ?? 0;
        }

        // A6: the env-opacity / content crossfade reads the WIDER ecotone overlap weights
        // when present (both adjacent biomes co-present across the band) and falls back to
        // the narrow seam weights for any chapter not participating in the active ecotone.
        // The fog colour/density lerp (updateGlobalEnvironment) still uses the narrow seam.
        const ecotoneWeights = this._resolvedBlendState.ecotoneWeights || null;

        this.environments.forEach((env, chapterId) => {
            let progressOpacity = this._resolvedBlendState.weights?.[chapterId] || 0;
            if (ecotoneWeights && ecotoneWeights[chapterId] !== undefined
                && (chapterId === this._resolvedBlendState.ecotone.sourceChapter
                    || chapterId === this._resolvedBlendState.ecotone.targetChapter)) {
                progressOpacity = ecotoneWeights[chapterId];
            }

            // B7 SEAM EARLY-IGNITE: for seams where the §4 plan wants the incoming biome to
            // read BEFORE the boundary (5->6 Space starfield, 7->8 Urban neon afterglow),
            // pull the incoming env opacity FORWARD. Math.max so it only ever appears EARLIER
            // (never dims the existing crossfade). Progress mode only.
            if (mode === 'progress') {
                const seamInBoost = this._seamInBoostFor(chapterId, this.cameraProgress);
                if (seamInBoost > progressOpacity) progressOpacity = seamInBoost;
            }

            const opacity = mode === 'progress'
                ? THREE.MathUtils.clamp(progressOpacity, 0, 1)
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

        // B7 — graceful journey-end ramp on the finale env (held by urban env / post).
        if (mode === 'progress') {
            this._applyJourneyEndDriver(this.cameraProgress);
        }
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
            this._blendStateScratch,
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
                // QW5: fade-eligible materials are made transparent:true permanently at
                // build (_collectOpacityTargets). Mirror that for any material that slipped
                // in without pre-recording, so we still never need to flip the flag here.
                material.userData.baseTransparent = material.transparent;
                material.userData.lastTransparent = material.transparent;
                material.transparent = true;
            }

            // QW5: drive ONLY the opacity. The .transparent flag stays true for the lifetime
            // of the material, so the GPU pipeline is never invalidated mid-crossfade — this
            // removes the per-seam recompile hitch that came from flipping .transparent +
            // setting needsUpdate=true while fading.
            material.opacity = material.userData.baseOpacity * clampedOpacity;
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
     * @param {object|null} directorState - Optional OdysseyDirector state for audio-reactive environments
     */
    update(delta, camera = null, cameraProgress = null, directorState = null) {
        this.time += delta;

        // Update each visible environment, then QW4-crossfade its rig lights by the SAME
        // opacity the visibility pass applied to the chapter's meshes (env.lastOpacity), so
        // the lights fade in lock-step with the biome without ever leaving the active light
        // set. Running the crossfade AFTER env.update() makes it a clean non-compounding
        // multiply (chapter updates rewrite intensity from scratch).
        this.environments.forEach((env) => {
            const updated = !!(env.group.visible && env.update);
            if (updated) {
                env.update(env.group, delta, this.time, camera, cameraProgress, directorState);
            }
            if (env.rigLights && env.rigLights.length > 0) {
                const weight = env.lastOpacity ?? (env.group.visible ? 1 : 0);
                this._applyLightCrossfade(env.rigLights, weight, updated);
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
     *
     * QW6: accepts an optional precomputed `blendState` so the per-frame caller can pass the
     * SAME state already resolved for updateVisibility (the board resolves it once via
     * getBlendState and hands it to updateVisibility). When omitted, reuse the cached
     * `_resolvedBlendState` that updateVisibility set this frame if it matches `progress`;
     * only as a last resort do we recompute. This collapses the previous 2× resolve/frame
     * (the heaviest GC source at seams) to a single resolve.
     * @param {number} progress - Camera progress (0-1)
     * @param {object|null} [blendState] - precomputed blend state for this progress (QW6)
     */
    updateGlobalEnvironment(progress, blendState = null) {
        let resolved = blendState;
        if (!resolved) {
            const cached = this._resolvedBlendState;
            // Reuse the state updateVisibility resolved this frame when it is for the same
            // progress (cameraProgress is clamped+stored there). Otherwise resolve once into
            // owned scratch (no fresh allocation) — never the previous double resolve.
            const clamped = THREE.MathUtils.clamp(progress ?? 0, 0, 1);
            resolved = (cached && this.cameraProgress === clamped)
                ? cached
                : resolveChapterBlendState(
                    progress,
                    CHAPTER_CONFIGS,
                    this.chapterPositions,
                    this._blendStateScratch,
                );
        }
        const currentChapterId = resolved.sourceChapter;
        const nextChapterId = resolved.targetChapter;
        const t = resolved.seamProgress;

        // ═══════════════════════════════════════════════════════════════════
        // Chapter Change Detection - Trigger callback for FOV pulse
        // ═══════════════════════════════════════════════════════════════════
        if (resolved.activeChapter !== this.currentChapter) {
            const previousChapter = this.currentChapter;
            this.currentChapter = resolved.activeChapter;

            console.log(`[ChapterEnvironmentManager] Chapter changed: ${previousChapter} → ${this.currentChapter}`);

            // Notify camera controller (for FOV pulse and other effects)
            if (this.onChapterChangeCallback) {
                this.onChapterChangeCallback(this.currentChapter, previousChapter);
            }
        }

        // Scene FOG is owned here unconditionally (single source of truth — the
        // chapter-profile atmosphere lerp). When OdysseyAtmosphere owns the rig it
        // still drives the dome/clear-color/ambient/lights, so those writes are gated
        // by `atmosphereOwned` below — but the fog color/density always comes from this
        // per-chapter lerp so the camera never crosses an uncoloured void.
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

            // B7 5->6 (the WORST seam): the violet atmospheric "soup" must EVAPORATE into
            // vacuum AHEAD of the colour crossfade so it doesn't read as "pink soup in
            // space". Front-load the DENSITY blend (pow < 1) on the 5->6 boundary only so
            // density rushes toward Space's near-zero early, while the COLOUR still lerps
            // linearly (the lavender survives only as the first distant nebula tint, not as
            // ambient volumetric fog). Every other seam keeps the linear density lerp.
            const densityBlend = (currentChapterId === 5 && nextChapterId === 6)
                ? blend ** 0.45
                : blend;
            fogDensity = THREE.MathUtils.lerp(currentFogDensity, nextFogDensity, densityBlend);
            ambientIntensity = THREE.MathUtils.lerp(
                currentAmbientIntensity,
                nextAmbientIntensity,
                blend,
            );
        }

        // SEAM 5->6 WIDE COLOUR LERP: override the fog/sky/ambient COLOUR with a wider,
        // smootherstep'd Sky(5)->Space(6) ramp centred on the 5-6 boundary so the violet
        // atmosphere dissolves to the near-black vacuum gradually instead of snapping inside
        // the narrow content seam. Decoupled from the ecotone (no extra double-render); the
        // DENSITY keeps its front-loaded evaporation (driven above) so this only smooths hue.
        const boundary56 = this.chapterPositions[5];
        if (Number.isFinite(boundary56)) {
            const colourStart = boundary56 - SEAM_56_COLOUR_HALF_WIDTH;
            const colourEnd = boundary56 + SEAM_56_COLOUR_HALF_WIDTH;
            const p = this.cameraProgress;
            if (p >= colourStart && p <= colourEnd) {
                const sky5 = this.chapterEnvironmentById.get(5);
                const space6 = this.chapterEnvironmentById.get(6);
                if (sky5 && space6) {
                    const colourBlend = smootherstep01(
                        (p - colourStart) / (colourEnd - colourStart),
                    );
                    skyColor.set(sky5.skyColor)
                        .lerp(this._blendColorScratch.set(space6.skyColor), colourBlend);
                    fogColor.set(sky5.fogColor)
                        .lerp(this._blendColorScratch.set(space6.fogColor), colourBlend);
                    ambientLight.set(sky5.ambientLight)
                        .lerp(this._blendColorScratch.set(space6.ambientLight), colourBlend);
                    ambientIntensity = THREE.MathUtils.lerp(
                        sky5.ambientIntensity,
                        space6.ambientIntensity,
                        colourBlend,
                    );
                }
            }
        }

        // Apply scene FOG — the single source of truth, written every frame
        // regardless of ownership (chapter-profile lerp drives colour + density).
        if (this.scene.fog instanceof THREE.FogExp2) {
            this.scene.fog.color.copy(fogColor);
            this.scene.fog.density = fogDensity;
        } else {
            this.scene.fog = new THREE.FogExp2(fogColor.clone(), fogDensity);
        }

        // When the atmosphere rig is active it owns clear-color + ambient/lights, so
        // skip those writes here to avoid double-driving them. Fog stays ours (above).
        if (this.atmosphereOwned) return;

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
            // QW4: this chapter's lights were reparented into the persistent rig — remove and
            // dispose them there (they are no longer children of env.group).
            if (env.rigLights) {
                for (const entry of env.rigLights) {
                    const { light } = entry;
                    this.persistentLightRig.remove(light);
                    if (typeof light.dispose === 'function') light.dispose();
                }
                env.rigLights.length = 0;
            }
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
        if (this.persistentLightRig) {
            this.environmentGroup.remove(this.persistentLightRig);
        }
        this.scene.remove(this.environmentGroup);

        console.log('[ChapterEnvironmentManager] Disposed');
    }
}

export default ChapterEnvironmentManager;
