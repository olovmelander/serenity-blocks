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
import { CHAPTER_SCENES, getChapterScene, exportNamesForScene } from './chapter-environments/registry.js';
import {
    SEAM_34_COLOUR_HALF_WIDTH,
    SEAM_45_COLOUR_HALF_WIDTH,
    SEAM_45_SKY_BRIDGE,
    SEAM_56_COLOUR_HALF_WIDTH,
    SEAM_56_AURORA_BRIDGE,
} from './chapter-environments/shared/seam-bridges.js';

// Chapter↔module wiring lives in the ONE registry (plan §4.5):
// chapter-environments/registry.js. Loaders are explicit dynamic-import thunks
// there (on-demand chunks, nothing heavy in the initial load); export names
// derive from the sceneId convention, pinned by
// tests/unit/chapter-registry-consistency.test.js.

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

    const entry = getChapterScene(chapterId);
    if (!entry) return null;

    const mod = await entry.load();
    const names = exportNamesForScene(entry.sceneId);

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
// 5->6: carry Sky's aurora INTO Space, then reveal the crisp starfield locally inside
// chapter 6. Earlier versions pulled Space fully forward across the tail of Sky, which
// made the seam technically smooth but visually cluttered: planets, rocks, stars and
// magenta nebula all arrived before the aurora had finished speaking.
// 7->8 afterglow: the singularity's core glow "becomes" the first neon — pull the Urban
//   (ch8) env opacity slightly FORWARD into the tail of Black Hole so the neon city resolves
//   out of the BH afterglow rather than snapping in.
const SEAM_78_AFTERGLOW_BAND = 0.05; // fraction of BH's span before the boundary to pre-seed neon
// Journey end: over the last ~18% of the FINAL chapter (aligned with the urban finale crane
//   + spire ignition window) expose a graceful 0->1 end ramp on the finale env's userData
//   (consumed for the exposure bleed / beacon hold) so the journey EASES out — a slow bleed
//   to the luminous payoff, never a hard cut at progress=1.
const JOURNEY_END_BAND = 0.18;

// SEAM 3->4 alpine + 5->6 aurora COLOUR bridges (SEAM_*_ALPINE/AURORA_BRIDGE + *_COLOUR_HALF_WIDTH)
// moved to chapter-environments/shared/seam-bridges.js (E3 — one source of truth; OdysseyDirector
// imports the SAME constants). The wide smootherstep'd colour window bridges Sky violet -> Space
// near-black through a deep teal midpoint so the change reads smooth, not a snap.

// 5→6 carry: the inherited summit chain + aurora are world-locked DEEP ahead (the camera
// never physically passes the hero peak in Ch6 — it stays ~400u in front), so they would
// "pop" the instant the manager flipped the Ch5 group invisible. Hold the Ch5 env fully
// present while the peak/aurora are still prominent, then ease the whole env opacity to 0
// over a long tail so they DISSOLVE as the camera moves on (sky-drift.js multiplies this
// chapterOpacity into the summit-ring + aurora NodeMaterials, which the manager can't reach).
const SEAM_56_CARRY_HOLD_BAND = 0.4; // fraction of Space span the Ch5 env stays fully present
const SEAM_56_AURORA_CARRY_BAND = 0.85; // fraction of Space span by which the Ch5 env has faded out

// 5→6 EARTH-AT-SUMMIT ignite: Chapter 6 owns the hero gas giant the player sees from the
// mountain top, but the chapter used to be hard-zero until the boundary — by which point
// the bright sky was already gone, so the "earth" could only ever appear against black.
// Ignite ch6 across the last ~43% of Ch5 so its group is present (and its update() runs)
// while the sky is still daylight. This ONLY grants presence: cosmic-expanse.js gates
// every element except the gas giant behind its own post-boundary `spaceReveal`, so this
// does NOT re-wash Space bright or pull stars/nebula/black hole into the Ch5 frame.
// The ignite SATURATES before the boundary (unlike the generic `ramp` helper, which only
// reaches 1 at the boundary) so the chapter is already fully weighted by the time the
// earth's own reveal fades up — otherwise the two ramps compound and the earth would only
// reach full opacity at the boundary, i.e. exactly when the sky starts going dark.
const SEAM_56_EARTH_IGNITE_START = 0.45; // fraction of the Ch5 span before the boundary
const SEAM_56_EARTH_IGNITE_END = 0.32; // ...and where it reaches full weight
// Hold full presence just past the boundary until the normal ecotone crossfade has
// caught up (it completes within ~6% of the Space span), so releasing the boost is a
// no-op rather than a dip. Without a release the boost would pin ch6 visible through
// chapters 7 and 8.
const SEAM_56_EARTH_HOLD_BAND = 0.10; // fraction of the Space span

function smootherstep01(value) {
    const t = THREE.MathUtils.clamp(value, 0, 1);
    return t * t * t * (t * (t * 6 - 15) + 10);
}

function smoothstep01(value) {
    const t = THREE.MathUtils.clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
}

function lerpColorViaBridge(out, startColor, bridgeHex, endColor, t, scratch) {
    const clamped = THREE.MathUtils.clamp(t, 0, 1);
    if (clamped < 0.5) {
        const bridgeT = smootherstep01(clamped * 2);
        return out.set(startColor).lerp(scratch.set(bridgeHex), bridgeT);
    }
    const spaceT = smootherstep01((clamped - 0.5) * 2);
    return out.set(bridgeHex).lerp(scratch.set(endColor), spaceT);
}

function lerpNumberViaBridge(start, bridge, end, t) {
    const clamped = THREE.MathUtils.clamp(t, 0, 1);
    if (clamped < 0.5) {
        return THREE.MathUtils.lerp(start, bridge, smootherstep01(clamped * 2));
    }
    return THREE.MathUtils.lerp(bridge, end, smootherstep01((clamped - 0.5) * 2));
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
            boundaryPosition,
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
        // Stage 1 lightweight-streaming (flag ?odysseyChapterLOD=1): when ON, off-center chapters
        // shed their heaviest sublayers via a per-frame detailLevel signal written in
        // updateVisibility + read by each chapter's update(). OFF → detailLevel is always
        // 'near'/'hidden' → behaviour identical to today.
        this.chapterLodEnabled = options.chapterLOD === true;
        // Velocity threshold (camera-progress Δ per updateVisibility call, ~per frame) above which
        // the journey drops to the cheap LOD tier — a fast scroll can't show per-chapter detail
        // anyway. Set BELOW the 0.26 maxScrollVelocity cap (~0.0043/frame at 60fps) so it still
        // fires within the (now lower 0.15) cap range. Tunable.
        this._lodFastThreshold = Number.isFinite(options.lodFastThreshold) ? options.lodFastThreshold : 0.0015;

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

        // LEVER 2 — chapter LRU eviction. Inert unless the board turns it on (default OFF;
        // ?odysseyChapterEvict=1). When on, chapters outside the active +/-N window are FULLY
        // disposed (geometry + material + textures/RTs + their reparented rig lights) and
        // re-created on approach. This OWNS residency, so the background loader must be off.
        this.evictionEnabled = false;
        this.evictionWindow = 2;
        this.onChapterRecreated = null; // board hook: re-queue prewarm + offscreen render-warm

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
     * LEVER 2 — enable/configure chapter LRU eviction. Inert until enabled:true.
     * @param {object} opts
     * @param {boolean} [opts.enabled]
     * @param {number} [opts.window] resident half-window N (active +/-N stays resident)
     * @param {Function|null} [opts.onRecreated] board hook fired after a chapter re-creates
     */
    setChapterEviction({ enabled, window, onRecreated } = {}) {
        if (typeof enabled === 'boolean') this.evictionEnabled = enabled;
        if (Number.isFinite(window)) this.evictionWindow = Math.max(1, Math.floor(window));
        if (typeof onRecreated === 'function' || onRecreated === null) this.onChapterRecreated = onRecreated;
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
     * LEVER 2 — FULLY free a single chapter's environment so the windowed-residency model can
     * reclaim its VRAM. Superset of dispose()'s per-env teardown: ALSO disposes material map
     * textures + uniform-value .isTexture + any userData RenderTargets (the dispose() path
     * leaks these). Removes ONLY this chapter's reparented lights from the shared
     * persistentLightRig, leaving every other resident chapter's crossfade intact.
     * @param {number} chapterId
     * @returns {boolean} true if an env was disposed
     */
    /**
     * Free ALL GPU resources for one environment and detach its group: this chapter's rig
     * lights, then geometry + material + every material-map texture + uniform .isTexture +
     * userData/group render targets — skipping shared cached-GLB meshes. The correct teardown
     * superset shared by both the eviction path (disposeChapterEnvironment) and full dispose()
     * (masterplan §2 #7). Does NOT touch this.environments bookkeeping — the caller owns that.
     * @param {object} env resolved environment record
     */
    _freeEnvironmentResources(env) {
        if (!env) return;
        // 1) Rig lights FIRST — remove ONLY this chapter's lights from the shared rig.
        if (env.rigLights) {
            for (const entry of env.rigLights) {
                const { light } = entry;
                this.persistentLightRig.remove(light);
                if (typeof light.dispose === 'function') light.dispose();
            }
            env.rigLights.length = 0;
        }

        // 2) Geometry + material + ALL textures (material maps AND uniform .isTexture) + RTs.
        if (env.group) {
            env.group.traverse((child) => {
                // Skip shared cached-GLB meshes (manta/whale/conifers): their geometry +
                // materials + textures are owned by the loadOdysseyGltfCached cache and shared
                // across chapters + re-create (SkeletonUtils.clone shares them by reference).
                // Disposing them would corrupt the cache + break re-create-on-approach; detaching
                // the group below suffices (the small GLB cache stays resident by design).
                if (child.userData?.fromSharedGltfCache) return;
                if (child.geometry && typeof child.geometry.dispose === 'function') {
                    child.geometry.dispose();
                }
                if (child.material) {
                    const materials = Array.isArray(child.material) ? child.material : [child.material];
                    materials.forEach((material) => {
                        if (!material) return;
                        Object.keys(material).forEach((key) => {
                            const val = material[key];
                            if (val && val.isTexture && typeof val.dispose === 'function') val.dispose();
                        });
                        if (material.uniforms) {
                            Object.keys(material.uniforms).forEach((key) => {
                                const uni = material.uniforms[key];
                                if (uni && uni.value && uni.value.isTexture
                                    && typeof uni.value.dispose === 'function') {
                                    uni.value.dispose();
                                }
                            });
                        }
                        if (typeof material.dispose === 'function') material.dispose();
                    });
                }
                const ud = child.userData;
                if (ud) {
                    Object.keys(ud).forEach((key) => {
                        const val = ud[key];
                        if (val && val.isRenderTarget && typeof val.dispose === 'function') val.dispose();
                    });
                }
            });
            const gud = env.group.userData;
            if (gud) {
                Object.keys(gud).forEach((key) => {
                    const val = gud[key];
                    if (val && val.isRenderTarget && typeof val.dispose === 'function') val.dispose();
                });
                // OD-11: dispose textures the traverse above CANNOT see — those bound only
                // inside TSL node graphs (via texture(canvasTex) in a colorNode/etc), never as
                // material.map or a uniform .value. Chapters register such owned textures here.
                if (Array.isArray(gud.ownedTextures)) {
                    gud.ownedTextures.forEach((tex) => {
                        if (tex && tex.isTexture && typeof tex.dispose === 'function') tex.dispose();
                    });
                    gud.ownedTextures.length = 0; // idempotent: a second teardown frees nothing
                }
                // Chapters register non-texture GPU resources needing teardown here — e.g. a hero
                // reflector()'s render targets, which live in a node graph the traverse can't reach
                // (SB-15 leak trap). Each entry is any object with a .dispose(); best-effort.
                if (Array.isArray(gud.ownedDisposables)) {
                    gud.ownedDisposables.forEach((d) => {
                        try {
                            if (d && typeof d.dispose === 'function') d.dispose();
                        } catch { /* best-effort teardown */ }
                    });
                    gud.ownedDisposables.length = 0; // idempotent
                }
            }
            this.environmentGroup.remove(env.group);
        }
    }

    disposeChapterEnvironment(chapterId) {
        const env = this.environments.get(chapterId);
        if (!env) return false;
        // Never free a chapter still drawing (visible with non-zero opacity) — retry once faded.
        if (env.group?.visible && (env.lastOpacity ?? 0) > 0) return false;

        this._freeEnvironmentResources(env);

        // 3) Drop from the residency map + null cached refs so VRAM/closures release.
        this.environments.delete(chapterId);
        env.group = null;
        env.opacityTargets = null;
        env.update = null;
        env.config = null;
        // _loadedModules (module-level) is intentionally KEPT — it caches only the
        // {config,create,update} fn refs (no GPU resources), so re-create skips the import().
        console.log(`[ChapterEnvironmentManager] Evicted chapter ${chapterId} environment`);
        return true;
    }

    /**
     * LEVER 2 — windowed residency. Keep [active-N .. active+N] resident (plus the seam
     * source/target and anything currently drawing), evict the rest, re-create chapters
     * entering the window. Inert unless setChapterEviction({enabled:true}) was called. Caps
     * work at 1 evict + 1 create per call so the CPU bake / GPU free spreads across frames.
     * @param {number} progress current camera progress (0..1)
     * @param {object} blendState resolved blend state (has activeChapter + source/target)
     */
    updateResidency(progress, blendState) {
        if (!this.evictionEnabled || !blendState) return;
        const chapterCount = CHAPTER_CONFIGS.length;
        const active = Number.isFinite(blendState.activeChapter)
            ? blendState.activeChapter : this.currentChapter;
        const N = this.evictionWindow;

        const resident = new Set();
        for (let id = active - N; id <= active + N; id += 1) {
            if (id >= 1 && id <= chapterCount) resident.add(id);
        }
        // Never evict the two chapters co-present at a seam, nor anything still drawing.
        if (Number.isFinite(blendState.sourceChapter)) resident.add(blendState.sourceChapter);
        if (Number.isFinite(blendState.targetChapter)) resident.add(blendState.targetChapter);
        this.environments.forEach((env, id) => {
            if (env.group?.visible && (env.lastOpacity ?? 0) > 0) resident.add(id);
        });

        // EVICT — farthest-from-active first, capped at 1 per call.
        let evictId = -1;
        let evictDist = -1;
        this.environments.forEach((env, id) => {
            if (resident.has(id)) return;
            const d = Math.abs(id - active);
            if (d > evictDist) { evictDist = d; evictId = id; }
        });
        if (evictId > 0) this.disposeChapterEnvironment(evictId);

        // RE-CREATE — nearest missing resident chapter first, capped at 1 per call.
        let createId = -1;
        let createDist = Infinity;
        resident.forEach((id) => {
            if (this.environments.has(id)) return;
            const d = Math.abs(id - active);
            if (d < createDist) { createDist = d; createId = id; }
        });
        if (createId > 0) {
            this.createChapterEnvironment(createId).then(() => {
                this.updateVisibility(this.cameraProgress, { mode: 'progress' });
                if (this.onChapterRecreated) this.onChapterRecreated(createId);
            }).catch((err) => {
                console.warn(`[ChapterEnvironmentManager] Re-create on approach failed for chapter ${createId}:`, err);
            });
        }
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
        const allChapterIds = CHAPTER_SCENES.map((entry) => entry.id);
        const remaining = allChapterIds.filter((id) => !alreadyLoaded.includes(id));
        const canRunTask = typeof options.canRunTask === 'function'
            ? options.canRunTask
            : () => true;
        const onEnvironmentCreated = typeof options.onEnvironmentCreated === 'function'
            ? options.onEnvironmentCreated
            : null;

        if (remaining.length === 0) return;

        console.log('[ChapterEnvironmentManager] Background loading chapters:', remaining);

        // Use setTimeout (NOT requestIdleCallback) so background chapter creation runs PROMPTLY
        // even while the player is actively scrolling: rAF starves idle callbacks, so the old
        // idle path let the player out-scroll the loader and each chapter built on-approach mid-
        // scroll (~400ms synchronous block = a hard stutter). A short gap between builds still
        // hands the live frame a slice. (With the all-chapters eager window this path is usually
        // a no-op, but it stays robust if the window is reduced via ?odysseyEagerWindow=0.)
        const scheduleNext = (fn) => setTimeout(fn, 60);

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
     * B7 — early-ignite opacity boost for seams where the incoming biome should read before
     * the boundary. 5->6 is intentionally excluded: Chapter 6 now handles its own staged
     * aurora-to-starfield reveal so the opening is not cluttered.
     *
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

        if (chapterId === 8) return ramp(SEAM_78_AFTERGLOW_BAND);
        if (chapterId === 6) return this._earthIgniteBoost(progress);
        return 0;
    }

    /**
     * 5→6 EARTH-AT-SUMMIT ignite (presence only — see SEAM_56_EARTH_IGNITE_START).
     * @param {number} progress current path progress (0..1)
     * @returns {number} 0..1 presence boost for chapter 6
     */
    _earthIgniteBoost(progress) {
        const boundary = this.chapterPositions[5];
        const skyStart = this.chapterPositions[4];
        const nextBoundary = this.chapterPositions[6] ?? 1;
        if (!Number.isFinite(boundary) || !Number.isFinite(skyStart) || boundary <= skyStart) {
            return 0;
        }

        if (progress >= boundary) {
            if (!Number.isFinite(nextBoundary) || nextBoundary <= boundary) return 0;
            const holdEnd = boundary + (nextBoundary - boundary) * SEAM_56_EARTH_HOLD_BAND;
            return progress <= holdEnd ? 1 : 0;
        }

        const skySpan = boundary - skyStart;
        const igniteStart = boundary - skySpan * SEAM_56_EARTH_IGNITE_START;
        const igniteEnd = boundary - skySpan * SEAM_56_EARTH_IGNITE_END;
        return smoothstep01((progress - igniteStart) / Math.max(1e-5, igniteEnd - igniteStart));
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
     * Stage 2 lightweight-streaming — generic FAR-tier particle LOD. When a chapter is nearly faded
     * ('far' = <35% opaque, or 'hidden'), hide its dense THREE.Points clouds (dust/embers/sparkles):
     * cheap to skip, and at that opacity it is imperceptible; restored the instant the chapter rises
     * back to mid/near. POINTS-ONLY + high-count so it never touches structural instanced geometry
     * (trees/buildings/star-structures). Called only on a detailLevel TRANSITION (a few times per
     * scroll), never per frame. Per-mesh _farLodHidden flag makes restore exact + idempotent.
     * @private
     */
    _applyFarParticleLod(group, detailLevel) {
        if (!group) return;
        const shed = detailLevel === 'far' || detailLevel === 'hidden';
        group.traverse((o) => {
            if (!o.isPoints) return;
            const count = o.geometry?.attributes?.position?.count ?? 0;
            if (count < 300) return;
            if (shed) {
                if (o.visible) {
                    o.userData._farLodHidden = true;
                    o.visible = false;
                }
            } else if (o.userData._farLodHidden) {
                o.visible = true;
                o.userData._farLodHidden = false;
            }
        });
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
            // Velocity-aware LOD: smoothed |Δprogress| per call. During a FAST scroll the player
            // can't perceive per-chapter detail, so the loop below forces the whole journey to the
            // cheap 'far' tier (reflector + all dense Points off via the Stage 1/2 gates); full
            // detail returns the instant they slow. Motion hides it → safe even for the centre.
            const dp = Math.abs(this.cameraProgress - (this._lodLastProgress ?? this.cameraProgress));
            this._lodLastProgress = this.cameraProgress;
            this._lodScrollSpeed = (this._lodScrollSpeed ?? 0) * 0.6 + dp * 0.4;
        } else {
            this.cameraY = position ?? 0;
        }
        const fastScroll = this.chapterLodEnabled && (this._lodScrollSpeed ?? 0) > this._lodFastThreshold;

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
                if (mode === 'progress'
                    && chapterId === 5
                    && this._resolvedBlendState.ecotone.boundaryId === '5-6') {
                    const boundary = this._resolvedBlendState.ecotone.boundaryPosition
                        ?? this.chapterPositions[5];
                    const end = this._resolvedBlendState.ecotone.end ?? boundary;
                    progressOpacity = this.cameraProgress <= boundary
                        ? 1
                        : smoothstep01((end - this.cameraProgress) / Math.max(1e-5, end - boundary));
                }
                if (mode === 'progress'
                    && chapterId === 6
                    && this._resolvedBlendState.ecotone.boundaryId === '5-6') {
                    const boundary = this._resolvedBlendState.ecotone.boundaryPosition
                        ?? this.chapterPositions[5];
                    const end = this._resolvedBlendState.ecotone.end ?? boundary;
                    progressOpacity = this.cameraProgress <= boundary
                        ? 0
                        : smoothstep01((this.cameraProgress - boundary) / Math.max(1e-5, end - boundary));
                }
            }

            // B7 SEAM EARLY-IGNITE: for seams where the §4 plan wants the incoming biome to
            // read BEFORE the boundary (7->8 Urban neon afterglow),
            // pull the incoming env opacity FORWARD. Math.max so it only ever appears EARLIER
            // (never dims the existing crossfade). Progress mode only.
            if (mode === 'progress') {
                const seamInBoost = this._seamInBoostFor(chapterId, this.cameraProgress);
                if (seamInBoost > progressOpacity) progressOpacity = seamInBoost;
                if (chapterId === 5) {
                    const boundary56 = this.chapterPositions[5];
                    const nextBoundary = this.chapterPositions[6] ?? 1;
                    if (Number.isFinite(boundary56)
                        && Number.isFinite(nextBoundary)
                        && nextBoundary > boundary56
                        && this.cameraProgress > boundary56) {
                        const spaceSpan = nextBoundary - boundary56;
                        const holdEnd = boundary56 + spaceSpan * SEAM_56_CARRY_HOLD_BAND;
                        const carryEnd = boundary56 + spaceSpan * SEAM_56_AURORA_CARRY_BAND;
                        // Hold fully present, then ease to 0 over the tail — a long graceful
                        // dissolve of the inherited peaks/aurora instead of a hard pop.
                        const carry = this.cameraProgress <= holdEnd
                            ? 1
                            : 1 - smoothstep01(
                                (this.cameraProgress - holdEnd) / Math.max(1e-5, carryEnd - holdEnd),
                            );
                        if (carry > progressOpacity) progressOpacity = carry;
                    }
                }
            }

            const opacity = mode === 'progress'
                ? THREE.MathUtils.clamp(progressOpacity, 0, 1)
                : THREE.MathUtils.clamp(
                    env.group.position.y >= (this.cameraY ?? 0) ? 1 : 0,
                    0,
                    1,
                );
            env.group.userData.chapterOpacity = opacity;
            // Stage 1 — per-chapter detail LOD signal. Off-center chapters read 'mid'/'far' so their
            // own update() sheds heavy sublayers WITHOUT teardown (no re-create hitch, no recompile).
            // Flag OFF (or the active/near chapter) always resolves to 'near'/'hidden' → identical to
            // today. String literals only, no per-frame allocation. group.visible is unchanged below,
            // so MID/FAR chapters still crossfade — only their heavy content is gated in update().
            let detailLevel = opacity > 0 ? 'near' : 'hidden';
            if (this.chapterLodEnabled && opacity > 0) {
                if (fastScroll) {
                    // Whole journey to the cheap tier while blasting past — motion hides it.
                    detailLevel = 'far';
                } else {
                    const activeCh = this._resolvedBlendState?.activeChapter;
                    if (chapterId === activeCh || opacity >= 0.85) detailLevel = 'near';
                    else if (opacity >= 0.35) detailLevel = 'mid';
                    else detailLevel = 'far';
                }
            }
            env.group.userData.detailLevel = detailLevel;
            if (this.chapterLodEnabled && env._lastDetailLevel !== detailLevel) {
                this._applyFarParticleLod(env.group, detailLevel);
                env._lastDetailLevel = detailLevel;
            }
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

        // ── L5 CANONICAL-RANGE DEDUP: draw ONE copy of the hero chain through each seam ──────
        // Chapters 3/4/5 each host the SAME world-locked hero chain at identical coords, so during
        // the 3→4 and 4→5 crossfades two byte-identical coplanar copies co-draw (z-fight + doubled
        // fill). Draw only the highest-opacity host through each seam (tie → active chapter); hide
        // the redundant copies. Ch5's ring is pinned to snow=1 + full alpenglow (see sky-drift.js) so
        // the hand-off is invisible. Fixed 3-slot scan; no per-frame allocation of note.
        if (mode === 'progress') {
            const g3 = this.environments.get(3)?.group;
            const g4 = this.environments.get(4)?.group;
            const g5 = this.environments.get(5)?.group;
            const rangeHosts = [
                [3, g3?.userData?.distantMountains, g3?.userData?.chapterOpacity ?? 0],
                [4, g4?.userData?.mainPeaks, g4?.userData?.chapterOpacity ?? 0],
                [5, g5?.userData?.summitRing, g5?.userData?.chapterOpacity ?? 0],
            ];
            const activeCh = this._resolvedBlendState?.activeChapter;
            let authorityId = -1;
            let authorityOpacity = 0;
            for (const [id, sub, op] of rangeHosts) {
                if (!sub || op <= 0) continue;
                if (op > authorityOpacity || (op === authorityOpacity && id === activeCh)) {
                    authorityOpacity = op;
                    authorityId = id;
                }
            }
            for (const [id, sub] of rangeHosts) {
                if (sub) {
                    const isAuthority = id === authorityId && authorityOpacity > 0;
                    sub.visible = isAuthority;
                    // Sticky verdict (2026-08): this pass runs on throttled updateVisibility
                    // frames, but the chapter env update() loops run EVERY frame and
                    // surface-world unconditionally re-showed its copy — so past the 3→4
                    // authority flip both byte-identical coplanar chains co-drew (z-fight)
                    // until Ch3's whole group hid ~0.419. Envs must honour this flag in
                    // their own per-frame visible writes.
                    sub.userData.rangeAuthority = isAuthority;
                }
            }
        }

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
        // Clamp delta to [0, 1/30s] ONCE here (Wave-0 F): the manager owns `this.time`, which
        // feeds every chapter's shader uTime and all env.update() integration, plus the
        // transition timer below. A tab-refocus or GC stall yields a huge raw delta that,
        // unclamped, jerks every chapter's animation forward in one visible jump. Capping at
        // 33 ms (a 30 fps floor) turns the spike into a gentle catch-up and guards negative
        // deltas — one place instead of a clamp in all eight chapter update() loops.
        const dt = Math.min(Math.max(delta, 0), 1 / 30);
        this.time += dt;

        // Update each visible environment, then QW4-crossfade its rig lights by the SAME
        // opacity the visibility pass applied to the chapter's meshes (env.lastOpacity), so
        // the lights fade in lock-step with the biome without ever leaving the active light
        // set. Running the crossfade AFTER env.update() makes it a clean non-compounding
        // multiply (chapter updates rewrite intensity from scratch).
        this.environments.forEach((env) => {
            const updated = !!(env.group.visible && env.update);
            if (updated) {
                env.update(env.group, dt, this.time, camera, cameraProgress, directorState);
            }
            if (env.rigLights && env.rigLights.length > 0) {
                const weight = env.lastOpacity ?? (env.group.visible ? 1 : 0);
                // Skip the rig-light intensity rewrite on settled, non-seam frames: re-apply
                // only when the chapter animated this frame OR the blend weight actually moved.
                if (updated || env._lastCrossfadeWeight === undefined
                    || Math.abs(weight - env._lastCrossfadeWeight) > 1e-4) {
                    this._applyLightCrossfade(env.rigLights, weight, updated);
                    env._lastCrossfadeWeight = weight;
                }
            }
        });

        // Handle transition animation
        if (this.isTransitioning) {
            this.transitionProgress += (dt * 1000) / this.transitionDuration;

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
        const environmentProgress = THREE.MathUtils.clamp(
            Number.isFinite(progress) ? progress : this.cameraProgress,
            0,
            1,
        );

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

            // 5->6: hold a little of Sky's thin aurora atmosphere past the boundary instead
            // of evaporating it early. Chapter 6 then reveals stars/nebula locally, so the
            // opening breathes before becoming hard vacuum.
            const densityBlend = (currentChapterId === 5 && nextChapterId === 6)
                ? blend ** 1.45
                : blend;
            fogDensity = THREE.MathUtils.lerp(currentFogDensity, nextFogDensity, densityBlend);
            ambientIntensity = THREE.MathUtils.lerp(
                currentAmbientIntensity,
                nextAmbientIntensity,
                blend,
            );
        }

        // WAVE 0.3 (2026-08): the alpine BRIDGE MIDPOINT is deleted; the wide WINDOW is kept.
        // Ch3 and Ch4 now carry byte-identical fogColor (0xbcd8ec) and skyColor (0x5aa8e0)
        // after the daylight re-palette, so routing the lerp through 0x638699 forced the fog
        // through a 3.0x luminance dip (rel-lum 0.659 -> 0.220 -> 0.659) at 2.18x density
        // (0.0011 -> 0.0024 -> 0.0015) over 196u and then undid it — a dip to nowhere, left
        // over from a dusk look that no longer exists. A direct lerp over the SAME wide window
        // keeps the smooth handoff (still wider than the content ecotone) and removes the dip.
        const boundary34 = this.chapterPositions[3];
        if (Number.isFinite(boundary34)) {
            const colourStart = boundary34 - SEAM_34_COLOUR_HALF_WIDTH;
            const colourEnd = boundary34 + SEAM_34_COLOUR_HALF_WIDTH;
            const p = environmentProgress;
            if (p >= colourStart && p <= colourEnd) {
                const surface3 = this.chapterEnvironmentById.get(3);
                const mountains4 = this.chapterEnvironmentById.get(4);
                if (surface3 && mountains4) {
                    const colourBlend = smootherstep01(
                        (p - colourStart) / (colourEnd - colourStart),
                    );
                    skyColor.set(surface3.skyColor)
                        .lerp(this._blendColorScratch.set(mountains4.skyColor), colourBlend);
                    fogColor.set(surface3.fogColor)
                        .lerp(this._blendColorScratch.set(mountains4.fogColor), colourBlend);
                    ambientLight.set(surface3.ambientLight)
                        .lerp(this._blendColorScratch.set(mountains4.ambientLight), colourBlend);
                    const aiA = surface3.ambientIntensity;
                    const aiB = mountains4.ambientIntensity;
                    ambientIntensity = THREE.MathUtils.lerp(aiA, aiB, colourBlend);
                    fogDensity = THREE.MathUtils.lerp(surface3.fogDensity, mountains4.fogDensity, colourBlend);
                }
            }
        }

        // SEAM 4->5 WIDE COLOUR + DENSITY LERP: bridge Mountains' bright azure into Sky-Drift's
        // deeper blue through a pale-cyan high-key midpoint, so the alpine -> cloud-cathedral
        // handoff brightens rather than snaps. Mirrors the 3->4 alpine bridge; colour-only (no
        // extra ecotone render cost).
        const boundary45 = this.chapterPositions[4];
        if (Number.isFinite(boundary45)) {
            const colourStart = boundary45 - SEAM_45_COLOUR_HALF_WIDTH;
            const colourEnd = boundary45 + SEAM_45_COLOUR_HALF_WIDTH;
            const p = environmentProgress;
            if (p >= colourStart && p <= colourEnd) {
                const mountains4 = this.chapterEnvironmentById.get(4);
                const sky5 = this.chapterEnvironmentById.get(5);
                if (mountains4 && sky5) {
                    const colourBlend = smootherstep01(
                        (p - colourStart) / (colourEnd - colourStart),
                    );
                    lerpColorViaBridge(
                        skyColor,
                        mountains4.skyColor,
                        SEAM_45_SKY_BRIDGE.skyColor,
                        sky5.skyColor,
                        colourBlend,
                        this._blendColorScratch,
                    );
                    lerpColorViaBridge(
                        fogColor,
                        mountains4.fogColor,
                        SEAM_45_SKY_BRIDGE.fogColor,
                        sky5.fogColor,
                        colourBlend,
                        this._blendColorScratch,
                    );
                    lerpColorViaBridge(
                        ambientLight,
                        mountains4.ambientLight,
                        SEAM_45_SKY_BRIDGE.ambientLight,
                        sky5.ambientLight,
                        colourBlend,
                        this._blendColorScratch,
                    );
                    ambientIntensity = lerpNumberViaBridge(
                        mountains4.ambientIntensity,
                        SEAM_45_SKY_BRIDGE.ambientIntensity,
                        sky5.ambientIntensity,
                        colourBlend,
                    );
                    fogDensity = lerpNumberViaBridge(
                        mountains4.fogDensity,
                        SEAM_45_SKY_BRIDGE.fogDensity,
                        sky5.fogDensity,
                        colourBlend,
                    );
                }
            }
        }

        // SEAM 5->6 WIDE COLOUR LERP: override the fog/sky/ambient COLOUR with a wider,
        // smootherstep'd Sky(5)->Space(6) ramp centred on the 5-6 boundary so the violet
        // atmosphere dissolves to the near-black vacuum gradually instead of snapping inside
        // the narrow content seam. Decoupled from the ecotone (no extra double-render); the
        // DENSITY is delayed slightly on this seam, so this bridges hue and ambience.
        const boundary56 = this.chapterPositions[5];
        if (Number.isFinite(boundary56)) {
            const colourStart = boundary56 - SEAM_56_COLOUR_HALF_WIDTH;
            const colourEnd = boundary56 + SEAM_56_COLOUR_HALF_WIDTH;
            const p = environmentProgress;
            if (p >= colourStart && p <= colourEnd) {
                const sky5 = this.chapterEnvironmentById.get(5);
                const space6 = this.chapterEnvironmentById.get(6);
                if (sky5 && space6) {
                    const colourBlend = smootherstep01(
                        (p - colourStart) / (colourEnd - colourStart),
                    );
                    lerpColorViaBridge(
                        skyColor,
                        sky5.skyColor,
                        SEAM_56_AURORA_BRIDGE.skyColor,
                        space6.skyColor,
                        colourBlend,
                        this._blendColorScratch,
                    );
                    lerpColorViaBridge(
                        fogColor,
                        sky5.fogColor,
                        SEAM_56_AURORA_BRIDGE.fogColor,
                        space6.fogColor,
                        colourBlend,
                        this._blendColorScratch,
                    );
                    lerpColorViaBridge(
                        ambientLight,
                        sky5.ambientLight,
                        SEAM_56_AURORA_BRIDGE.ambientLight,
                        space6.ambientLight,
                        colourBlend,
                        this._blendColorScratch,
                    );
                    if (colourBlend < 0.5) {
                        ambientIntensity = THREE.MathUtils.lerp(
                            sky5.ambientIntensity,
                            SEAM_56_AURORA_BRIDGE.ambientIntensity,
                            smootherstep01(colourBlend * 2),
                        );
                    } else {
                        ambientIntensity = THREE.MathUtils.lerp(
                            SEAM_56_AURORA_BRIDGE.ambientIntensity,
                            space6.ambientIntensity,
                            smootherstep01((colourBlend - 0.5) * 2),
                        );
                    }
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
        // Full teardown reuses the eviction path's complete walk (§2 #7): frees textures +
        // uniform-textures + render targets the old body leaked, and skips fromSharedGltfCache
        // meshes so mode teardown no longer corrupts the module-level GLB cache (manta/whale/
        // conifers) — which would break them on the NEXT Odyssey entry. No visibility guard here:
        // teardown frees everything regardless of what's currently drawing.
        this.environments.forEach((env) => this._freeEnvironmentResources(env));

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
