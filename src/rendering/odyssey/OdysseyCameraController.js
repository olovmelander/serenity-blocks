/**
 * @fileoverview OdysseyCameraController - Camera navigation for Odyssey Board
 *
 * Handles camera movement, zoom, and transitions along the path.
 * Supports follow mode, free mode, and focused node viewing.
 */

import * as THREE from 'three/webgpu';
import { ODYSSEY_PATH_DATA } from './path-data.js';
import {
    ODYSSEY_ACTS,
    getChapterProfile,
} from './chapter-environments/shared/chapter-profile.js';

const DEFAULT_CHAPTER_POSITIONS = ODYSSEY_PATH_DATA.chapterPositions || [0, 1];
const CHAPTER_1_LOOK_DOWN = new THREE.Vector3(0, -26, 0);
const CHAPTER_1_LOOK_FADE_RANGE = 0.035;
const FREE_CAMERA_WORLD_UP = new THREE.Vector3(0, 1, 0);
const PATH_FRAME_GRAVITY_UP = new THREE.Vector3(0, 1, 0);
const ACT_TRAVEL_SPEEDS = Object.freeze({
    [ODYSSEY_ACTS.ORIGIN]: 7.5,
    [ODYSSEY_ACTS.LIVING]: 6.0,
    [ODYSSEY_ACTS.BEYOND]: 4.2,
    [ODYSSEY_ACTS.TRANSCENDENCE]: 7.0,
});

// ═══════════════════════════════════════════════════════════════════════════════
// UNIT A7-CAMERA — Per-chapter framing overrides (data-driven, easy to tweak)
//
// All biases are expressed in the camera's PATH-FRAME basis so they ride the
// spline cleanly regardless of world orientation:
//   • forward  → along the travel tangent (+ pushes the look target down-path)
//   • right    → path "right" (rule-of-thirds yaw; + biases toward screen-right)
//   • up       → path "up"/gravity-blended normal (+ raises the look target)
// Camera-position nudges (camRight / camUp / camForward) reframe the eye itself so
// the hero / set piece sits in frame instead of the void. Keep heroes off
// dead-centre (rule-of-thirds) and lerp between chapters via FRAMING_BLEND_RATE.
//
// Defaults (all zero) preserve the legacy framing for any chapter not listed.
// ═══════════════════════════════════════════════════════════════════════════════
const DEFAULT_CHAPTER_FRAMING = Object.freeze({
    // Look-target bias in path-frame units.
    lookForward: 0,
    lookRight: 0,
    lookUp: 0,
    // Eye/position bias in path-frame units.
    camRight: 0,
    camUp: 0,
    camForward: 0,
    // Earth-Core descent: scales the legacy straight-down look offset
    // (0 = forward-looking, 1 = original top-down). Only chapter 1 uses this.
    downLookScale: 1,
    // Roll-stabilisation: blend the camera up-vector toward WORLD up (0 = the legacy
    // path-normal/gravity blend, 1 = pure world up). On a near-vertical spline the
    // Frenet normal twists the up-vector and rolls the horizon (Ch5 measured ~42°); a
    // high worldUp levels it. Default 0 leaves every other chapter untouched.
    worldUp: 0,
    // Scales the climb-bias up-push on the look target (1 = legacy "look up the climb").
    // Ch5 sets this low/negative so the gentle aim drops to the peak+aurora horizon
    // instead of staring up the near-vertical rail. Default 1 = unchanged.
    climbScale: 1,
});

const CHAPTER_FRAMING_OVERRIDES = Object.freeze({
    // 1 — Earth Core (origin): kill the top-down lava shaft. Drop the downward
    // look to a low 3/4 "descending into the core" angle, raise the look target,
    // and push the eye up + back a touch so the magma horizon and charred crust
    // read ahead instead of a vertical well over void.
    1: Object.freeze({
        // Strengthened from the first pass (still read too top-down on capture):
        // near-eliminate the downward look and lean the aim forward + up so the
        // magma-horizon band (added in the Earth Core set-piece pass) reads ahead.
        downLookScale: 0.65,
        lookForward: 4.0,
        lookUp: 0.5,
        camUp: 1.4,
        camForward: -2.2,
    }),
    // 2 — Deep Ocean (origin) 🏆 FLAGSHIP: REVEAL the true vertical so the dive
    // reads bright caustic ceiling above -> teal mid -> indigo abyss below. The
    // STATIC entry below is the mid-act baseline (used to seed _activeFraming and as
    // the resolveChapterFraming fallback); the live three-act arc (early tilt UP,
    // mid level-to-leviathan biased left, late tilt DOWN) is applied per in-chapter
    // progress in resolveChapter2Framing()/updateChapterFraming() so a static camera
    // table can still stage a vertical reveal across the chapter.
    2: Object.freeze({
        lookRight: -4.0,
        lookUp: 1.0,
    }),
    // 3 — Surface (living): the Great Tree HERO landmark sits off the LEFT of the path
    // (~x=40 from the path, biased -X in the env). Small lookAt bias toward it at the
    // hero beat so the eye returns to the landmark (mirrors BH singularity / Urban
    // spire). Kept gentle — the act stays open and forward; the tree is the anchor, not
    // a hard re-aim. The live hero-beat strengthening rides resolveChapter3Framing().
    3: Object.freeze({
        lookForward: 2.0,
        lookRight: -1.6,
        lookUp: 1.2,
    }),
    // 4 — Mountains (living): favour the three-peak "V" with the path leading up
    // to the node. Slightly lower eye + look up the path toward the summit.
    4: Object.freeze({
        lookForward: 3.0,
        lookUp: 3.4,
        camUp: -1.6,
        camForward: -1.0,
    }),
    // 5 — Sky (beyond): mid-act baseline for the staged summit-liftoff arc in
    // resolveChapter5Framing(). The camera begins by holding the receding mountain in
    // the lower frame, then cranes into the aurora/sun canopy once the rail has safely
    // cleared the peak mass.
    5: Object.freeze({
        lookForward: 1.2,
        lookUp: 1.8,
        lookRight: -1.4,
        camUp: 1.0,
        camForward: -1.2,
    }),
    // 6 — Space (beyond): hero gas giant sits up-and-left of the dead-ahead black
    // hole. Bias yaw left + lift so the planet rides the left third of frame. The yaw
    // bias was softened (-5.0 -> -3.2) so the galaxy/triad on the RIGHT third stops
    // getting shoved off the right edge (the env marches it inward via uApproach).
    6: Object.freeze({
        lookRight: -3.2,
        lookUp: 2.4,
        camRight: 2.6,
        camUp: 1.0,
    }),
    // 7 — Black Hole (transcendence): preserve the strong entry composition — keep
    // the accretion disk biased off dead-centre (slightly low-right) for the run.
    7: Object.freeze({
        lookRight: 3.2,
        lookUp: -1.4,
        camRight: -1.6,
        camUp: 1.4,
    }),
    // 8 — Urban Encore (transcendence): city spire / neon hero sits to one side;
    // bias the aim toward it instead of the empty wet avenue ahead.
    8: Object.freeze({
        // Finale: the city canyon + megastructure spire are re-centred on the path
        // (improve pass), so look forward + up the corridor toward them and pull the
        // eye back/up for the reveal instead of biasing off to one empty side.
        lookForward: 5.0,
        lookRight: 1.5,
        lookUp: 2.5,
        camForward: -3.0,
        camUp: 1.5,
    }),
});

// Exponential blend rate (per second) for easing between per-chapter framings.
const FRAMING_BLEND_RATE = 2.4;

const FRAMING_KEYS = Object.freeze([
    'lookForward', 'lookRight', 'lookUp', 'camRight', 'camUp', 'camForward', 'downLookScale',
    'worldUp', 'climbScale',
]);

function resolveChapterFraming(chapterId) {
    return {
        ...DEFAULT_CHAPTER_FRAMING,
        ...(CHAPTER_FRAMING_OVERRIDES[chapterId] || {}),
    };
}

// Chapter 1 opens as a legible "above the Level 1 orb" lava-floor view, then settles
// back into the established upward core-shaft framing as the journey starts moving.
const CHAPTER_1_BASE = CHAPTER_FRAMING_OVERRIDES[1];
const CHAPTER_1_START_FRAMING = Object.freeze({
    ...DEFAULT_CHAPTER_FRAMING,
    downLookScale: 1.05,
    lookForward: 1.8,
    lookUp: -2.8,
    camUp: 4.8,
    camForward: -4.0,
});
const CHAPTER_1_SETTLE_START = 0.12;
const CHAPTER_1_SETTLE_END = 0.34;

function resolveChapter1Framing(t) {
    const clamped = THREE.MathUtils.clamp(t, 0, 1);
    const settle = THREE.MathUtils.smoothstep(clamped, CHAPTER_1_SETTLE_START, CHAPTER_1_SETTLE_END);
    const base = { ...DEFAULT_CHAPTER_FRAMING, ...CHAPTER_1_BASE };
    const out = { ...DEFAULT_CHAPTER_FRAMING };
    for (let i = 0; i < FRAMING_KEYS.length; i += 1) {
        const key = FRAMING_KEYS[i];
        out[key] = THREE.MathUtils.lerp(CHAPTER_1_START_FRAMING[key], base[key], settle);
    }
    return out;
}

// ── Chapter 2 Deep Ocean — three-act vertical-reveal arc ──────────────────────────
// The single most important Deep Ocean fix: with one level camera the dive only ever
// sees the gradient's pale-teal mid-band. Stage a vertical reveal as a function of the
// camera's progress WITHIN chapter 2:
//   • EARLY  (0.0): tilt UP toward the shimmering surface / god-rays   = "light far above"
//   • MID    (0.5): level toward the leviathan, biased to the left third (hero off-centre)
//   • LATE   (1.0): tilt DOWN toward the glowing reef / indigo abyss   = the dive-out
// Each keyframe is a full framing record (DEFAULT + overrides) so the lerp is total and
// never leaks another chapter's bias. Smoothstep-crossfaded between the three acts; the
// result still flows through the SAME _activeFraming seam-lerp path as every chapter.
const CHAPTER_2_ARC = Object.freeze({
    early: Object.freeze({
        ...DEFAULT_CHAPTER_FRAMING,
        lookUp: 6.0,
        lookForward: 3.0,
        camUp: 2.0,
    }),
    mid: Object.freeze({
        ...DEFAULT_CHAPTER_FRAMING,
        lookRight: -4.0,
        lookUp: 1.0,
    }),
    late: Object.freeze({
        ...DEFAULT_CHAPTER_FRAMING,
        lookUp: -6.0,
        camUp: -2.0,
    }),
});

/**
 * Resolve the chapter-2 framing for an in-chapter progress (0=entry, 1=exit) by
 * crossfading the early/mid/late acts. Returns a full framing record (no allocation of
 * a new closure path — a plain object is fine; this runs once per frame only in ch2).
 * @param {number} t in-chapter progress 0..1
 * @returns {object} framing record
 */
function resolveChapter2Framing(t) {
    const clamped = THREE.MathUtils.clamp(t, 0, 1);
    // early -> mid over [0, 0.5], mid -> late over [0.5, 1].
    const toMid = THREE.MathUtils.smoothstep(clamped, 0.0, 0.5);
    const toLate = THREE.MathUtils.smoothstep(clamped, 0.5, 1.0);
    const out = { ...DEFAULT_CHAPTER_FRAMING };
    for (let i = 0; i < FRAMING_KEYS.length; i += 1) {
        const key = FRAMING_KEYS[i];
        const earlyToMid = THREE.MathUtils.lerp(CHAPTER_2_ARC.early[key], CHAPTER_2_ARC.mid[key], toMid);
        out[key] = THREE.MathUtils.lerp(earlyToMid, CHAPTER_2_ARC.late[key], toLate);
    }
    return out;
}

// ── Chapter 3 Surface — hero-tree beat strengthening ──────────────────────────────
// Chapter 3's static override (CHAPTER_FRAMING_OVERRIDES[3]) is a gentle baseline bias
// toward the Great Tree landmark (off the left of the path). At the HERO BEAT (mid-
// chapter, ~0.35..0.65) strengthen that lookAt bias so the eye clearly returns to the
// tree, then relax it so the act-out craning toward the rising ridgeline (3->4) reads.
// Returns a full framing record so the lerp is total (never leaks another chapter's bias).
const CHAPTER_3_BASE = CHAPTER_FRAMING_OVERRIDES[3];
function resolveChapter3Framing(t) {
    // Hero-beat envelope: rises into the mid-chapter tree pass, eases back out.
    const beat = THREE.MathUtils.smoothstep(t, 0.18, 0.42)
        * (1 - THREE.MathUtils.smoothstep(t, 0.62, 0.86));
    const out = { ...DEFAULT_CHAPTER_FRAMING, ...CHAPTER_3_BASE };
    // Deepen the toward-the-tree yaw/pitch at the beat (additive on the baseline bias).
    out.lookRight = (CHAPTER_3_BASE.lookRight ?? 0) - 2.2 * beat;
    out.lookUp = (CHAPTER_3_BASE.lookUp ?? 0) + 0.8 * beat;
    return out;
}

// ── Chapter 4 Mountains — SADDLE-APPROACH intimacy ─────────────────────────────────
// Creative plan ch4 item 2 ("not close enough to peaks... HUD camera distance ~30
// throughout, so the notch barely grows"): through local progress 0.6→0.9 the camera
// closes on the V-notch — eye pushed forward and threaded toward the LEFT wall so the
// saddle crossing grazes the foreground cornice — while the aim lifts so the summit
// visibly GROWS in frame. Returns a full framing record so the lerp is total.
const CHAPTER_4_BASE = CHAPTER_FRAMING_OVERRIDES[4];
function resolveChapter4Framing(t) {
    const approach = THREE.MathUtils.smoothstep(t, 0.6, 0.9);
    const out = { ...DEFAULT_CHAPTER_FRAMING, ...CHAPTER_4_BASE };
    out.camForward = (CHAPTER_4_BASE.camForward ?? 0) + 4.6 * approach; // close on the notch
    out.camRight = (CHAPTER_4_BASE.camRight ?? 0) - 1.8 * approach; // thread near the left wall
    out.camUp = (CHAPTER_4_BASE.camUp ?? 0) + 0.6 * approach; // graze over the cornice
    out.lookUp = (CHAPTER_4_BASE.lookUp ?? 0) + 1.2 * approach; // the summit grows in frame
    return out;
}

// ── Chapter 5 Sky Drift — summit-liftoff composition ─────────────────────────────
// The rail now physically clears the canonical Ch4 hero peak; the camera needs to make
// that legible. Entry holds a lower, wider mountain+rail composition, the middle opens
// the aurora behind the summit, and the exit cranes into the sky/space hand-off.
// Composition overhaul (2026-06-15): the Ch5 spline is near-vertical (load-bearing for
// mountain clearance), so the legacy path-frame framing rolled the horizon ~42° and
// craned the eye ~69° up at empty sky. worldUp levels the horizon; climbScale 0 kills
// the climb up-push; a negative lookUp drops the aim to the peak+aurora HORIZON so the
// snowy summits fill the lower frame and the aurora arcs above them the whole chapter.
// The EXIT relaxes worldUp + cranes back up for the Sky→Space hand-off. lookUp values
// calibrated against the live NDC projection in the playground harness.
const CHAPTER_5_ENTRY_FRAMING = Object.freeze({
    ...DEFAULT_CHAPTER_FRAMING,
    worldUp: 0.92,
    climbScale: 0,
    lookForward: 1.0,
    lookRight: -1.6,
    lookUp: -40.0,
    camUp: 0.6,
    camForward: -1.6,
});
const CHAPTER_5_BASE = Object.freeze({
    ...DEFAULT_CHAPTER_FRAMING,
    worldUp: 0.92,
    climbScale: 0,
    lookForward: 1.0,
    lookRight: -0.6,
    lookUp: -46.0,
    camUp: 0.9,
    camForward: -1.2,
});
const CHAPTER_5_EXIT_FRAMING = Object.freeze({
    ...DEFAULT_CHAPTER_FRAMING,
    worldUp: 0.5,
    climbScale: 0.5,
    lookForward: 3.4,
    lookRight: 1.6,
    lookUp: 1.0,
    camUp: 2.2,
    camForward: -0.2,
});
function resolveChapter5Framing(t) {
    const clamped = THREE.MathUtils.clamp(t, 0, 1);
    const toCanopy = THREE.MathUtils.smoothstep(clamped, 0.12, 0.56);
    const toExit = THREE.MathUtils.smoothstep(clamped, 0.74, 1.0);
    const out = { ...DEFAULT_CHAPTER_FRAMING };
    for (let i = 0; i < FRAMING_KEYS.length; i += 1) {
        const key = FRAMING_KEYS[i];
        const entryToBase = THREE.MathUtils.lerp(
            CHAPTER_5_ENTRY_FRAMING[key],
            CHAPTER_5_BASE[key],
            toCanopy,
        );
        out[key] = THREE.MathUtils.lerp(entryToBase, CHAPTER_5_EXIT_FRAMING[key], toExit);
    }
    return out;
}

// ── Chapter 8 Urban — FINALE CRANE arc ────────────────────────────────────────────
// Chapter 8's static override is the mid-act baseline. Over the LAST ~18% of the chapter
// the camera CRANES up the igniting megastructure spire to reveal it firing past the top
// of frame: camUp 1.5->6, lookUp 2.5->7, smoothstep-eased. The env exposes group.userData
// .uReveal (ignition, driven by the urban env); this is the matching camera move. Returns
// a full framing record so the lerp is total. Flows through the SAME _activeFraming path.
const CHAPTER_8_BASE = CHAPTER_FRAMING_OVERRIDES[8];
const CHAPTER_8_CRANE_START = 0.82; // last ~18%
function resolveChapter8Framing(t) {
    const crane = THREE.MathUtils.smoothstep(t, CHAPTER_8_CRANE_START, 1.0);
    const out = { ...DEFAULT_CHAPTER_FRAMING, ...CHAPTER_8_BASE };
    out.camUp = THREE.MathUtils.lerp(CHAPTER_8_BASE.camUp ?? 0, 6.0, crane);
    out.lookUp = THREE.MathUtils.lerp(CHAPTER_8_BASE.lookUp ?? 0, 7.0, crane);
    return out;
}

function resolveChapterFramingForProgress(chapterId, inChapterProgress = 0) {
    if (chapterId === 1) return resolveChapter1Framing(inChapterProgress);
    if (chapterId === 2) return resolveChapter2Framing(inChapterProgress);
    if (chapterId === 3) return resolveChapter3Framing(inChapterProgress);
    if (chapterId === 4) return resolveChapter4Framing(inChapterProgress);
    if (chapterId === 5) return resolveChapter5Framing(inChapterProgress);
    if (chapterId === 8) return resolveChapter8Framing(inChapterProgress);
    return resolveChapterFraming(chapterId);
}

export { resolveChapterFramingForProgress };

function buildChapterBoundaryPositions(chapterPositions) {
    const terminalTrimmed = chapterPositions[chapterPositions.length - 1] >= 1
        ? chapterPositions.slice(0, -1)
        : chapterPositions;

    return terminalTrimmed
        .slice(1)
        .map((position, index) => ({
            id: `${index + 1}-${index + 2}`,
            fromChapter: index + 1,
            toChapter: index + 2,
            position,
        }));
}

/**
 * OdysseyCameraController - Camera navigation along the odyssey path
 */
export class OdysseyCameraController {
    constructor(camera, pathCurve, options = {}) {
        this.camera = camera;
        this.pathCurve = pathCurve;
        this.levelPositions = Array.isArray(options.levelPositions)
            ? options.levelPositions.filter((position) => Number.isFinite(position))
            : [];
        this.chapterPositions = Array.isArray(options.chapterPositions) && options.chapterPositions.length >= 2
            ? [...options.chapterPositions]
            : [...DEFAULT_CHAPTER_POSITIONS];
        this.chapterBoundaryPositions = buildChapterBoundaryPositions(this.chapterPositions);
        this.chapter1EndPosition = this.chapterPositions[1] ?? 0.125;
        this.startPosition = Number.isFinite(options.startPosition)
            ? options.startPosition
            : (this.levelPositions[0] ?? this.chapterPositions[0] ?? 0);

        // State
        this.mode = 'follow'; // 'follow' | 'free' | 'focus'
        this.currentPosition = this.startPosition; // Start framed toward Level 1
        this.targetPosition = this.startPosition;
        this.lookAtTarget = new THREE.Vector3();
        this.lookAtOffset = new THREE.Vector3();
        this.freeCameraQuaternion = new THREE.Quaternion();
        this.freeCameraTempQuat = new THREE.Quaternion();
        this.freeCameraDirection = new THREE.Vector3(0, 0, -1);
        this.freeCameraUp = new THREE.Vector3(0, 1, 0);
        this.freeCameraRight = new THREE.Vector3(1, 0, 0);
        this.freeCameraAnchor = new THREE.Vector3();
        this.followCameraUp = new THREE.Vector3(0, 1, 0);
        this.positionSeamBeat = null;

        // Animation state
        this.isAnimating = false;
        this.animationStartTime = 0;
        this.animationDuration = 0;
        this.animationStartPos = new THREE.Vector3();
        this.animationEndPos = new THREE.Vector3();
        this.animationStartLookAt = new THREE.Vector3();
        this.animationEndLookAt = new THREE.Vector3();
        this.animationStartFov = camera?.fov ?? 60;
        this.animationEndFov = camera?.fov ?? 60;
        this.animationResolve = null;
        this.animationKind = null;
        this.portalApproach = null;
        this.pathTravel = null;
        this.seamBeat = null;
        this.vistaBeat = null;
        this.directorCamera = {
            followDistance: 28,
            fovBase: camera?.fov ?? 60,
            sway: 1,
            bob: 1,
            drift: 1,
            energy: 0,
            beatPulse: 0,
        };
        this.directorCameraTarget = { ...this.directorCamera };
        this._dynamicFollowOffset = new THREE.Vector3();
        this._framePosition = new THREE.Vector3();
        this._frameTangent = new THREE.Vector3();
        this._frameNormal = new THREE.Vector3();
        this._frameRight = new THREE.Vector3();
        // B7 (perf): reused scratch for computeFollowFrame's per-frame outputs so the always-on
        // camera follow stops allocating ~3 Vector3/frame (clones + an untargeted getPathDataAt) —
        // that per-frame GC is a contributor to the scroll/seam frame-time spikes. Aliasing-safe:
        // updateFollowPosition (the only caller) copies/lerps camPos/lookTarget into persistent
        // targets synchronously and never retains them; these three stay distinct from the
        // _frame* frame vectors above (camPos ≠ position, cameraUp ≠ normal, lookTarget ≠ position).
        this._frameCamPos = new THREE.Vector3();
        this._frameCameraUp = new THREE.Vector3();
        this._frameLookTarget = new THREE.Vector3();
        // Discard sink for the look-ahead getPathDataAt's tangent/normal/right, which that call
        // computes but the caller ignores (only the look-ahead POSITION is used). Passing one
        // shared throwaway for all three avoids 3 fresh Vector3/frame — they're overwritten in
        // sequence and never read, so the aliasing is intentional and harmless.
        this._frameThrow = new THREE.Vector3();

        // UNIT A7-CAMERA: smoothed per-chapter framing. `_activeFraming` is eased
        // toward the resolved framing of the chapter under the camera so boundary
        // changes never snap. Seeded from the start chapter so the first frame is
        // already framed correctly.
        const startChapterId = this._getChapterAtProgress(this.currentPosition);
        this._activeFraming = resolveChapterFramingForProgress(
            startChapterId,
            this._getInChapterProgress(startChapterId),
        );
        this._framingInitialized = false;

        // Configuration
        this.config = {
            // Raised well ABOVE the path (was -1.4, slightly below) so the camera looks
            // down on the journey at an elevated 3/4 angle; pulled back via followDistance.
            followOffset: new THREE.Vector3(0, 7, 18),
            followLerpSpeed: 0.03,
            scrollSpeed: 0.15, // Reduced from 0.5
            // Cap on manual scroll velocity (progress units/sec). A hard wheel flick used to
            // build unbounded velocity and teleport across the map; this keeps the travel
            // readable AND lets the background chapter render-warm stay ahead of the player.
            // The gentle cinematic auto-drift is well under this, so it only bites flicks.
            maxScrollVelocity: 0.4,
            focusDistance: 10,
            minPosition: 0, // Allow scrolling all the way to Level 1
            maxPosition: 1, // Allow scrolling all the way to the end
            magneticRadius: 0.004,
            magneticFriction: 0.45,
            idleAutoDrift: options.idleAutoDrift !== false,
            autoDriftScale: 0.55,
            beatDriftScale: 0.55,
            freeCamera: {
                lookSensitivity: 0.0015,
                keyboardRotateSpeed: 1.35,
                pitchLimit: Math.PI * 0.49,
                lookDistance: 18,
                wheelDollyDistance: 72,
                progressSampleCount: 240,
                pathLutSamples: 2048,
            },
        };

        // ═══════════════════════════════════════════════════════════════════
        // Cinematic Camera Breathing Settings
        // ═══════════════════════════════════════════════════════════════════
        this.cinematicConfig = {
            // Subtle sway (horizontal drift)
            swayEnabled: true,
            swayAmplitude: 0.15, // World units of horizontal movement
            swayFrequency: 0.3, // Cycles per second (slow, dreamlike)

            // Gentle bob (vertical float)
            bobEnabled: true,
            bobAmplitude: 0.08, // World units of vertical movement
            bobFrequency: 0.4, // Slightly faster than sway

            // Camera roll breathing (very subtle tilt)
            rollEnabled: true,
            rollAmplitude: 0.003, // Radians (~0.17 degrees)
            rollFrequency: 0.25, // Very slow

            // FOV pulse for chapter transitions
            fovPulseEnabled: true,
            baseFov: 60,
            fovPulseAmount: 8, // Degrees to expand/contract
            fovPulseDuration: 1.5, // Seconds for full pulse cycle

            // Look-ahead bias (anticipate path direction)
            lookAheadEnabled: true,
            lookAheadDistance: 0.02, // How far ahead on path (0-1)
        };

        // Breathing animation state
        this.breatheTime = 0;
        this.fovPulseActive = false;
        this.fovPulseStartTime = 0;
        this.fovPulseType = 'expand'; // 'expand' | 'contract'
        this.fovPulseAmount = this.cinematicConfig.fovPulseAmount;
        this.fovPulseDuration = this.cinematicConfig.fovPulseDuration;
        this.lastChapterId = 1;
        this.freeCameraState = {
            lookDistance: this.config.freeCamera.lookDistance,
        };
        this.travelModel = {
            velocity: 0,
            lastInputAt: 0,
            inputVelocity: 0,
            pathLength: 1,
        };

        // Initialize LUT
        this._buildPathLut();

        // Initialize camera position
        this.updateFollowPosition({ direct: true });
    }

    _buildPathLut() {
        const count = this.config.freeCamera.pathLutSamples;
        this.pathLut = {
            positions: new Float32Array(count * 3), // x, y, z
            tangents: new Float32Array(count * 3), // x, y, z
            normals: new Float32Array(count * 3),
            rights: new Float32Array(count * 3),
            count,
        };
        this.travelModel.pathLength = Math.max(1, this.pathCurve?.getLength?.() || 1);

        const point = new THREE.Vector3();
        const tangent = new THREE.Vector3();
        const previousTangent = new THREE.Vector3();
        const normal = new THREE.Vector3();
        const right = new THREE.Vector3();
        const rotationAxis = new THREE.Vector3();
        const rotation = new THREE.Matrix4();

        for (let i = 0; i < count; i++) {
            const t = i / (count - 1);
            this.pathCurve.getPointAt(t, point);
            this.pathCurve.getTangentAt(t, tangent).normalize();

            if (i === 0) {
                const seedUp = Math.abs(tangent.dot(PATH_FRAME_GRAVITY_UP)) > 0.92
                    ? new THREE.Vector3(0, 0, 1)
                    : PATH_FRAME_GRAVITY_UP.clone();
                right.crossVectors(tangent, seedUp).normalize();
                normal.crossVectors(right, tangent).normalize();
            } else {
                rotationAxis.crossVectors(previousTangent, tangent);
                if (rotationAxis.lengthSq() > 1e-8) {
                    rotationAxis.normalize();
                    const angle = previousTangent.angleTo(tangent);
                    rotation.makeRotationAxis(rotationAxis, angle);
                    normal.applyMatrix4(rotation).normalize();
                }
                right.crossVectors(tangent, normal).normalize();
                normal.crossVectors(right, tangent).normalize();
            }
            previousTangent.copy(tangent);

            const idx = i * 3;
            this.pathLut.positions[idx] = point.x;
            this.pathLut.positions[idx + 1] = point.y;
            this.pathLut.positions[idx + 2] = point.z;

            this.pathLut.tangents[idx] = tangent.x;
            this.pathLut.tangents[idx + 1] = tangent.y;
            this.pathLut.tangents[idx + 2] = tangent.z;

            this.pathLut.normals[idx] = normal.x;
            this.pathLut.normals[idx + 1] = normal.y;
            this.pathLut.normals[idx + 2] = normal.z;
            this.pathLut.rights[idx] = right.x;
            this.pathLut.rights[idx + 1] = right.y;
            this.pathLut.rights[idx + 2] = right.z;
        }
    }

    /**
     * Get interpolated path position and tangent from LUT
     * @param {number} t - 0 to 1
     * @param {THREE.Vector3} [optionalTargetPos]
     * @param {THREE.Vector3} [optionalTargetTangent]
     * @returns {{position: THREE.Vector3, tangent: THREE.Vector3}}
     */
    getPathDataAt(t, optionalTargetPos, optionalTargetTangent, optionalTargetNormal, optionalTargetRight) {
        const clampedT = THREE.MathUtils.clamp(t, 0, 1);
        const { count } = this.pathLut;
        const rawIdx = clampedT * (count - 1);
        const i0 = Math.floor(rawIdx);
        const i1 = Math.min(i0 + 1, count - 1);
        const lerp = rawIdx - i0;

        const pos = optionalTargetPos || new THREE.Vector3();
        const tan = optionalTargetTangent || new THREE.Vector3();
        const normal = optionalTargetNormal || new THREE.Vector3();
        const right = optionalTargetRight || new THREE.Vector3();

        const idx0 = i0 * 3;
        const idx1 = i1 * 3;

        pos.set(
            THREE.MathUtils.lerp(this.pathLut.positions[idx0], this.pathLut.positions[idx1], lerp),
            THREE.MathUtils.lerp(this.pathLut.positions[idx0 + 1], this.pathLut.positions[idx1 + 1], lerp),
            THREE.MathUtils.lerp(this.pathLut.positions[idx0 + 2], this.pathLut.positions[idx1 + 2], lerp),
        );

        tan.set(
            THREE.MathUtils.lerp(this.pathLut.tangents[idx0], this.pathLut.tangents[idx1], lerp),
            THREE.MathUtils.lerp(this.pathLut.tangents[idx0 + 1], this.pathLut.tangents[idx1 + 1], lerp),
            THREE.MathUtils.lerp(this.pathLut.tangents[idx0 + 2], this.pathLut.tangents[idx1 + 2], lerp),
        ).normalize();

        normal.set(
            THREE.MathUtils.lerp(this.pathLut.normals[idx0], this.pathLut.normals[idx1], lerp),
            THREE.MathUtils.lerp(this.pathLut.normals[idx0 + 1], this.pathLut.normals[idx1 + 1], lerp),
            THREE.MathUtils.lerp(this.pathLut.normals[idx0 + 2], this.pathLut.normals[idx1 + 2], lerp),
        ).normalize();

        right.set(
            THREE.MathUtils.lerp(this.pathLut.rights[idx0], this.pathLut.rights[idx1], lerp),
            THREE.MathUtils.lerp(this.pathLut.rights[idx0 + 1], this.pathLut.rights[idx1 + 1], lerp),
            THREE.MathUtils.lerp(this.pathLut.rights[idx0 + 2], this.pathLut.rights[idx1 + 2], lerp),
        ).normalize();

        return {
            position: pos,
            tangent: tan,
            normal,
            right,
        };
    }

    applyLayout(pathCurve, options = {}) {
        if (pathCurve) {
            this.pathCurve = pathCurve;
            this._buildPathLut();
        }

        if (Array.isArray(options.levelPositions)) {
            this.levelPositions = options.levelPositions.filter((position) => Number.isFinite(position));
        }

        if (Array.isArray(options.chapterPositions) && options.chapterPositions.length >= 2) {
            this.chapterPositions = [...options.chapterPositions];
        }

        this.chapterBoundaryPositions = buildChapterBoundaryPositions(this.chapterPositions);
        this.chapter1EndPosition = this.chapterPositions[1] ?? this.chapter1EndPosition;
        this.startPosition = Number.isFinite(options.startPosition)
            ? options.startPosition
            : (this.levelPositions[0] ?? this.chapterPositions[0] ?? 0);

        const preservePosition = Number.isFinite(options.preservePosition)
            ? options.preservePosition
            : this.currentPosition;
        const clampedPosition = THREE.MathUtils.clamp(
            preservePosition,
            this.config.minPosition,
            this.config.maxPosition,
        );

        this.currentPosition = clampedPosition;
        this.targetPosition = clampedPosition;
        if (this.mode === 'free') {
            return;
        }
        this.updateFollowPosition({ position: clampedPosition, direct: true });
    }

    /**
     * Scroll along the path
     * @param {number} delta - Scroll amount (-1 to 1)
     */
    scroll(delta) {
        if (this.mode === 'free') {
            this.dollyFree(-delta * this.config.freeCamera.wheelDollyDistance);
            return;
        }

        if (this.pathTravel?.active || (this.isAnimating && this.mode === 'focus')) {
            this._cancelActiveAnimation(false);
            this.mode = 'follow';
        }

        // Apply magnetic friction if near a level
        let effectiveDelta = delta;
        const nearestLevel = this.findNearestLevel(this.targetPosition);

        if (nearestLevel) {
            const distance = Math.abs(this.targetPosition - nearestLevel);
            if (distance < this.config.magneticRadius) {
                // If we are moving AWAY from the level, don't apply as much friction
                // If we are moving TOWARDS or ACROSS the level, apply friction
                const movingAway = (delta > 0 && this.targetPosition > nearestLevel)
                    || (delta < 0 && this.targetPosition < nearestLevel);

                if (!movingAway) {
                    effectiveDelta *= this.config.magneticFriction;
                } else {
                    // Slight sticky feel when leaving too
                    effectiveDelta *= 0.6;
                }
            }
        }

        this.targetPosition = THREE.MathUtils.clamp(
            this.targetPosition + effectiveDelta * this.config.scrollSpeed,
            this.config.minPosition,
            this.config.maxPosition,
        );
        this.travelModel.lastInputAt = performance.now();
        this.travelModel.inputVelocity += effectiveDelta * this.config.scrollSpeed * 2.4;
    }

    findNearestLevel(position) {
        if (!this.levelPositions.length) return null;

        // Binary search for nearest position in sorted array
        let low = 0;
        let high = this.levelPositions.length - 1;

        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            const val = this.levelPositions[mid];

            if (val < position) {
                low = mid + 1;
            } else if (val > position) {
                high = mid - 1;
            } else {
                return val; // Exact match
            }
        }

        // Check the two closest candidates
        const left = high >= 0 ? this.levelPositions[high] : null;
        const right = low < this.levelPositions.length ? this.levelPositions[low] : null;

        let nearest = null;
        let minDist = Infinity;

        if (left !== null) {
            minDist = Math.abs(position - left);
            nearest = left;
        }

        if (right !== null) {
            const dist = Math.abs(position - right);
            if (dist < minDist) {
                minDist = dist;
                nearest = right;
            }
        }

        // Only return if within reasonable range to care
        return minDist < 0.1 ? nearest : null;
    }

    /**
     * Pan to a specific position along the path
     * @param {number} position - 0 to 1
     * @param {number} duration - Animation duration in ms
     */
    panToPosition(position, duration = 1500, options = {}) {
        return this.travelToPosition(position, duration, options);
    }

    /**
     * Travel along the Odyssey path while keeping logical progress in sync.
     * @param {number} position - 0 to 1
     * @param {number} duration - Animation duration in ms
     * @param {Object} options
     * @returns {Promise<boolean>}
     */
    travelToPosition(position, duration = 1500, options = {}) {
        const clampedPosition = THREE.MathUtils.clamp(
            position,
            this.config.minPosition,
            this.config.maxPosition,
        );

        this._cancelActiveAnimation(false);
        this.portalApproach = null;
        this.mode = 'follow';
        this.targetPosition = clampedPosition;
        this.isAnimating = true;
        this.animationKind = 'path-travel';

        const startPosition = THREE.MathUtils.clamp(
            options.startPosition ?? this.currentPosition,
            this.config.minPosition,
            this.config.maxPosition,
        );
        const travelDuration = Math.max(1, duration);
        const direction = Math.sign(clampedPosition - startPosition);

        this.pathTravel = {
            active: true,
            startTime: performance.now(),
            duration: travelDuration,
            startPosition,
            lastPosition: startPosition,
            endPosition: clampedPosition,
            direction,
            progress: 0,
            crossedBoundaryIds: [],
        };

        return new Promise((resolve) => {
            this.animationResolve = resolve;
            this.currentPosition = startPosition;
            this.updateFollowPosition({ direct: true });
        });
    }

    /**
     * Focus camera on a specific node position
     * @param {THREE.Vector3} nodePosition
     * @param {number} duration - Animation duration in ms
     */
    focusOnNode(nodePosition, duration = 800) {
        this._cancelActiveAnimation(false);
        this.portalApproach = null;
        this.mode = 'focus';
        this.isAnimating = true;
        this.animationKind = 'focus';
        this.animationStartTime = performance.now();
        this.animationDuration = duration;

        this.animationStartPos.copy(this.camera.position);
        this.animationEndPos.copy(nodePosition).add(new THREE.Vector3(0, 2, this.config.focusDistance));

        this.animationStartLookAt.copy(this.lookAtTarget);
        this.animationEndLookAt.copy(nodePosition);
        this.animationStartFov = this.camera.fov;
        this.animationEndFov = this.camera.fov;

        return new Promise((resolve) => {
            this.animationResolve = resolve;
        });
    }

    /**
     * Rapid zoom into a position (for dramatic level entry)
     * @param {THREE.Vector3} targetPosition - Position to zoom toward
     * @param {number} duration - Animation duration in ms
     */
    zoomToPosition(targetPosition, duration = 600) {
        this._cancelActiveAnimation(false);
        this.portalApproach = null;
        this.mode = 'focus';
        this.isAnimating = true;
        this.animationKind = 'zoom';
        this.animationStartTime = performance.now();
        this.animationDuration = duration;

        this.animationStartPos.copy(this.camera.position);

        // Zoom very close to the position (almost inside it)
        const zoomOffset = new THREE.Vector3(0, 0, 1); // Very close
        this.animationEndPos.copy(targetPosition).add(zoomOffset);

        this.animationStartLookAt.copy(this.lookAtTarget);
        this.animationEndLookAt.copy(targetPosition);
        this.animationStartFov = this.camera.fov;
        this.animationEndFov = this.camera.fov;

        console.log('[Camera] Zooming to position', targetPosition);

        return new Promise((resolve) => {
            this.animationResolve = resolve;
        });
    }

    /**
     * Clean level-entry zoom for Odyssey board launch.
     * Uses one eased dolly plus a controlled FOV contraction.
     * @param {Object} config
     * @param {THREE.Vector3} config.targetPosition
     * @param {number} [config.durationMs]
     * @param {number} [config.fovStart]
     * @param {number} [config.fovEnd]
     * @param {number} [config.distanceBias]
     * @returns {boolean}
     */
    playLevelEntryZoom({
        targetPosition,
        durationMs = 520,
        fovStart = this.camera.fov,
        fovEnd = Math.max(34, this.camera.fov - 12),
        distanceBias = 0.34,
    } = {}) {
        if (!(targetPosition instanceof THREE.Vector3)) {
            return false;
        }

        this._cancelActiveAnimation(false);
        this.portalApproach = null;
        this.mode = 'focus';
        this.isAnimating = true;
        this.animationKind = 'level-entry-zoom';
        this.animationStartTime = performance.now();
        this.animationDuration = Math.max(1, durationMs);

        const startPosition = this.camera.position.clone();
        const direction = startPosition.clone().sub(targetPosition);
        if (direction.lengthSq() < 1e-6) {
            this.camera.getWorldDirection(direction);
            direction.multiplyScalar(-1);
        }
        direction.normalize();

        const startDistance = Math.max(startPosition.distanceTo(targetPosition), 1);
        const stopDistance = THREE.MathUtils.clamp(startDistance * distanceBias, 2.75, 14);
        const endPosition = targetPosition.clone()
            .addScaledVector(direction, stopDistance)
            .add(new THREE.Vector3(0, 0.2, 0));

        this.animationStartPos.copy(startPosition);
        this.animationEndPos.copy(endPosition);
        this.animationStartLookAt.copy(this.lookAtTarget);
        this.animationEndLookAt.copy(targetPosition);
        this.animationStartFov = fovStart;
        this.animationEndFov = Math.min(fovStart, fovEnd);
        this.camera.fov = fovStart;
        this.camera.updateProjectionMatrix();

        return true;
    }

    /**
     * Dedicated portal-entry approach used during Odyssey orb lock.
     * The motion is split into alignment, accelerating dolly, then suction into the orb.
     * @param {Object} config
     * @param {THREE.Vector3} config.targetPosition
     * @param {number} [config.targetRadius]
     * @param {number} [config.duration]
     * @param {string} [config.motionPreset]
     * @returns {boolean}
     */
    playPortalApproach({
        targetPosition,
        targetRadius = 0.14,
        duration = 650,
        motionPreset = 'default',
    } = {}) {
        if (!(targetPosition instanceof THREE.Vector3)) {
            return false;
        }

        this._cancelActiveAnimation(false);
        const startPosition = this.camera.position.clone();
        const startLookAt = this.lookAtTarget.clone();
        const startDistance = Math.max(startPosition.distanceTo(targetPosition), 1);
        const approachDirection = startPosition.clone().sub(targetPosition);

        if (approachDirection.lengthSq() < 1e-6) {
            this.camera.getWorldDirection(approachDirection);
            approachDirection.multiplyScalar(-1);
        }
        approachDirection.normalize();

        const cameraQuaternion = this.camera.quaternion.clone();
        const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(cameraQuaternion).normalize();
        const cameraUp = new THREE.Vector3(0, 1, 0).applyQuaternion(cameraQuaternion).normalize();

        const nearDistance = -0.05; // Plunge straight through the literal center
        const midDistance = Math.max(1.5, startDistance * 0.42);
        const lockDistance = Math.max(midDistance + 2.8, startDistance * 0.82);

        const lockPosition = targetPosition.clone()
            .addScaledVector(approachDirection, lockDistance)
            .addScaledVector(cameraUp, 0.22);
        const midPosition = targetPosition.clone()
            .addScaledVector(approachDirection, midDistance)
            .addScaledVector(cameraRight, 0.42)
            .addScaledVector(cameraUp, 0.12);
        const finalPosition = targetPosition.clone()
            .addScaledVector(approachDirection, nearDistance);

        this.mode = 'focus';
        this.isAnimating = false;
        this.animationKind = null;
        this.fovPulseActive = false;
        this.portalApproach = {
            active: true,
            startTime: performance.now(),
            duration: Math.max(1, duration),
            startPosition,
            startLookAt,
            targetPosition: targetPosition.clone(),
            targetRadius: THREE.MathUtils.clamp(targetRadius, 0.04, 0.38),
            motionPreset,
            startFov: this.camera.fov,
            lockPosition,
            midPosition,
            finalPosition,
            approachDirection,
            cameraRight,
            cameraUp,
        };

        return true;
    }

    /**
     * Quick zoom in (for fallback)
     * @param {number} factor - Zoom multiplier
     * @param {number} duration - Animation duration in ms
     */
    zoomIn(factor = 2, duration = 600) {
        this._cancelActiveAnimation(false);
        this.isAnimating = true;
        this.animationKind = 'zoom';
        this.animationStartTime = performance.now();
        this.animationDuration = duration;

        this.animationStartPos.copy(this.camera.position);

        // Move camera closer along the look direction
        const direction = new THREE.Vector3();
        this.camera.getWorldDirection(direction);
        this.animationEndPos.copy(this.camera.position).addScaledVector(direction, this.config.focusDistance * factor);

        this.animationStartLookAt.copy(this.lookAtTarget);
        this.animationEndLookAt.copy(this.lookAtTarget);
        this.animationStartFov = this.camera.fov;
        this.animationEndFov = this.camera.fov;

        return new Promise((resolve) => {
            this.animationResolve = resolve;
        });
    }

    /**
     * Update camera each frame
     * @param {number} deltaTime
     */
    update(deltaTime) {
        // Update breathing time
        this.breatheTime += deltaTime;
        // Desired view-axis roll for this frame, applied AFTER lookAt() (which would otherwise
        // rebuild the quaternion and discard any camera.rotation.z written before it). Set by
        // applyBreathingMotion() and updatePortalApproach(); 0 = no roll. (masterplan §2 #6)
        this._pendingViewRoll = 0;
        this.updateDirectorCamera(deltaTime);
        this.updateChapterFraming(deltaTime);

        if (this.pathTravel?.active) {
            this.updatePathTravel();
        } else if (this.portalApproach?.active) {
            this.updatePortalApproach();
        } else if (this.isAnimating) {
            this.updateAnimation();
        } else if (this.mode === 'follow') {
            this.updateFollow(deltaTime);
        }

        this.updateSeamBeat();
        this.updateVistaBeat();

        // Apply cinematic breathing effects
        this.applyBreathingMotion(deltaTime);

        // Keep the baseline framing synced to the OdysseyDirector camera profile.
        this.applyBaseFov(deltaTime);

        // Update FOV pulse
        this.updateFovPulse(deltaTime);

        // Free camera is driven directly from its quaternion to avoid lookAt singularities.
        if (this.mode === 'free') {
            this.camera.quaternion.copy(this.freeCameraQuaternion);
            this.camera.updateMatrixWorld(true);
            return;
        }

        this.camera.up.copy(this.followCameraUp || FREE_CAMERA_WORLD_UP);
        this.camera.lookAt(this.lookAtTarget);

        // Re-apply the subtle breathing / portal-approach roll about the local view axis,
        // AFTER lookAt has set the orientation (masterplan §2 #6 — this roll was previously
        // written to camera.rotation.z before lookAt and silently discarded every frame).
        if (this._pendingViewRoll) {
            this.camera.rotateZ(this._pendingViewRoll);
        }
    }

    /**
     * Apply subtle breathing motion (sway, bob, roll)
     * @param {number} deltaTime
     */
    applyBreathingMotion(deltaTime) {
        const cc = this.cinematicConfig;
        const t = this.breatheTime;
        const seamWeight = this.getSeamBeatStrength();
        const vistaWeight = this.getVistaBeatStrength();
        const swayScale = this.directorCamera.sway * (1 + this.directorCamera.energy * 0.12);
        const bobScale = this.directorCamera.bob * (1 + this.directorCamera.beatPulse * 0.08);
        const driftScale = this.directorCamera.drift;

        // Don't apply during rapid animations (focus/zoom)
        if (this.mode === 'free' || this.portalApproach?.active || (this.isAnimating && this.mode === 'focus')) return;

        // Horizontal sway (dreamlike drift)
        if (cc.swayEnabled) {
            const sway = Math.sin(t * Math.PI * 2 * cc.swayFrequency) * cc.swayAmplitude * swayScale;
            this.camera.position.x += sway * deltaTime * 2; // Smooth application
        }

        // Vertical bob (gentle float)
        if (cc.bobEnabled) {
            const bob = Math.sin(t * Math.PI * 2 * cc.bobFrequency + Math.PI * 0.5) * cc.bobAmplitude * bobScale;
            this.camera.position.y += bob * deltaTime * 2;
        }

        // Camera roll (very subtle tilt)
        if (cc.rollEnabled) {
            const rollAmplitude = cc.rollAmplitude * driftScale * (1 - (seamWeight * 0.82)) * (1 - vistaWeight * 0.55);
            const roll = Math.sin(t * Math.PI * 2 * cc.rollFrequency) * rollAmplitude;
            // Deferred to after lookAt() in update() so it isn't discarded (masterplan §2 #6).
            this._pendingViewRoll = roll;
        }
    }

    setDirectorState(directorState = null) {
        const cameraState = directorState?.camera;
        if (!cameraState) return;

        // Ceiling raised 32 -> 44 so the per-act camera language can actually WIDEN to the
        // BEYOND act (followDistance 42, the 4->5 "buoyant float") and the TRANSCENDENCE
        // act (36, the 6->7 "gravitational inward pull"). The old 32 cap silently clamped
        // both BEYOND/TRANSCENDENCE back to the LIVING framing — the act widen never read.
        this.directorCameraTarget.followDistance = THREE.MathUtils.clamp(
            cameraState.followDistance ?? this.directorCameraTarget.followDistance,
            10,
            44,
        );
        this.directorCameraTarget.fovBase = THREE.MathUtils.clamp(
            cameraState.fovBase ?? this.directorCameraTarget.fovBase,
            48,
            74,
        );
        this.directorCameraTarget.sway = THREE.MathUtils.clamp(cameraState.sway ?? 1, 0.25, 1.8);
        this.directorCameraTarget.bob = THREE.MathUtils.clamp(cameraState.bob ?? 1, 0.25, 1.8);
        this.directorCameraTarget.drift = THREE.MathUtils.clamp(cameraState.drift ?? 1, 0.25, 1.8);
        this.directorCameraTarget.energy = THREE.MathUtils.clamp(directorState.energy ?? 0, 0, 1);
        this.directorCameraTarget.beatPulse = THREE.MathUtils.clamp(directorState.beatPulse ?? 0, 0, 1);
    }

    updateDirectorCamera(deltaTime) {
        const lerp = 1 - Math.exp(-Math.max(0, deltaTime) * 2.6);
        const target = this.directorCameraTarget;
        const current = this.directorCamera;

        current.followDistance = THREE.MathUtils.lerp(current.followDistance, target.followDistance, lerp);
        current.fovBase = THREE.MathUtils.lerp(current.fovBase, target.fovBase, lerp);
        current.sway = THREE.MathUtils.lerp(current.sway, target.sway, lerp);
        current.bob = THREE.MathUtils.lerp(current.bob, target.bob, lerp);
        current.drift = THREE.MathUtils.lerp(current.drift, target.drift, lerp);
        current.energy = THREE.MathUtils.lerp(current.energy, target.energy, lerp);
        current.beatPulse = THREE.MathUtils.lerp(current.beatPulse, target.beatPulse, lerp);
        this.cinematicConfig.baseFov = current.fovBase;
    }

    /**
     * UNIT A7-CAMERA: ease the active per-chapter framing toward the chapter under
     * the camera so set-piece / hero composition crossfades smoothly at seams.
     * @param {number} deltaTime
     */
    /**
     * In-chapter progress (0=chapter entry, 1=chapter exit) for the given chapter id
     * at the current path progress. Used by the chapter-2 three-act vertical reveal.
     * @param {number} chapterId
     * @returns {number}
     */
    _getInChapterProgress(chapterId) {
        const start = this.chapterPositions[chapterId - 1];
        const end = this.chapterPositions[chapterId] ?? 1;
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
        return THREE.MathUtils.clamp((this.currentPosition - start) / (end - start), 0, 1);
    }

    updateChapterFraming(deltaTime) {
        const chapterId = this._getChapterAtProgress(this.currentPosition);
        // A few chapters stage a target framing that varies with the camera's progress
        // THROUGH the chapter (a live act-arc), not a single static override:
        //   • ch2 Deep Ocean — three-act vertical reveal (tilt up -> level -> tilt down)
        //   • ch3 Surface     — hero-tree lookAt strengthening at the mid-chapter beat
        //   • ch5 Sky Drift    — summit hold -> aurora canopy -> atmosphere-edge crane
        //   • ch8 Urban        — finale CRANE up the igniting spire over the last ~18%
        // Every other chapter uses its static override.
        const target = resolveChapterFramingForProgress(
            chapterId,
            this._getInChapterProgress(chapterId),
        );
        const active = this._activeFraming;

        // Snap on the very first frame (avoids a visible ease-in from defaults on load).
        if (!this._framingInitialized) {
            this._framingInitialized = true;
            Object.assign(active, target);
            return;
        }

        const lerp = 1 - Math.exp(-Math.max(0, deltaTime) * FRAMING_BLEND_RATE);
        active.lookForward = THREE.MathUtils.lerp(active.lookForward, target.lookForward, lerp);
        active.lookRight = THREE.MathUtils.lerp(active.lookRight, target.lookRight, lerp);
        active.lookUp = THREE.MathUtils.lerp(active.lookUp, target.lookUp, lerp);
        active.camRight = THREE.MathUtils.lerp(active.camRight, target.camRight, lerp);
        active.camUp = THREE.MathUtils.lerp(active.camUp, target.camUp, lerp);
        active.camForward = THREE.MathUtils.lerp(active.camForward, target.camForward, lerp);
        active.downLookScale = THREE.MathUtils.lerp(active.downLookScale, target.downLookScale, lerp);
        active.worldUp = THREE.MathUtils.lerp(active.worldUp ?? 0, target.worldUp ?? 0, lerp);
        active.climbScale = THREE.MathUtils.lerp(active.climbScale ?? 1, target.climbScale ?? 1, lerp);
    }

    applyBaseFov(deltaTime) {
        if (this.mode !== 'follow') {
            return;
        }
        if (this.fovPulseActive || this.portalApproach?.active || (this.isAnimating && this.mode === 'focus')) {
            return;
        }

        const targetFov = this.directorCamera.fovBase;
        if (!Number.isFinite(targetFov)) return;

        const lerp = 1 - Math.exp(-Math.max(0, deltaTime) * 2.2);
        const nextFov = THREE.MathUtils.lerp(this.camera.fov, targetFov, lerp);
        if (Math.abs(nextFov - this.camera.fov) > 0.01) {
            this.camera.fov = nextFov;
            this.camera.updateProjectionMatrix();
        }
    }

    /**
     * Update FOV pulse animation
     */
    updateFovPulse() {
        const cc = this.cinematicConfig;
        if (!cc.fovPulseEnabled || !this.fovPulseActive || this.portalApproach?.active) return;

        const elapsed = (performance.now() - this.fovPulseStartTime) / 1000;
        const t = Math.min(elapsed / this.fovPulseDuration, 1);

        // Smooth ease-out curve
        const eased = 1 - (1 - t) ** 3;

        if (this.fovPulseType === 'expand') {
            // Expand then contract
            const pulseT = t < 0.4 ? t / 0.4 : 1 - (t - 0.4) / 0.6;
            const smoothPulse = Math.sin(pulseT * Math.PI) * this.fovPulseAmount;
            this.camera.fov = cc.baseFov + smoothPulse;
        } else {
            // Just contract (tunnel effect)
            const smoothPulse = (1 - eased) * this.fovPulseAmount;
            this.camera.fov = cc.baseFov - smoothPulse * 0.5;
        }

        this.camera.updateProjectionMatrix();

        // End pulse
        if (t >= 1) {
            this.fovPulseActive = false;
            this.camera.fov = cc.baseFov;
            this.camera.updateProjectionMatrix();
        }
    }

    /**
     * Trigger FOV pulse effect (for chapter transitions)
     * @param {string} type - 'expand' | 'contract'
     */
    triggerFovPulse(type = 'expand', options = {}) {
        if (!this.cinematicConfig.fovPulseEnabled) return;

        this.fovPulseActive = true;
        this.fovPulseStartTime = performance.now();
        this.fovPulseType = type;
        this.fovPulseAmount = options.amount ?? this.cinematicConfig.fovPulseAmount;
        this.fovPulseDuration = options.duration ?? this.cinematicConfig.fovPulseDuration;
    }

    /**
     * Notify camera of chapter change (for transition effects)
     * @param {number} chapterId
     */
    onChapterChange(chapterId) {
        if (chapterId !== this.lastChapterId) {
            this.triggerFovPulse('expand');
            this.lastChapterId = chapterId;
        }
    }

    triggerChapterSeam({
        durationMs = 850,
        intensity = 1,
        direction = 1,
    } = {}) {
        this.seamBeat = {
            active: true,
            startTime: performance.now(),
            duration: Math.max(1, durationMs),
            intensity: THREE.MathUtils.clamp(intensity, 0, 1.6),
            direction: Math.sign(direction) || 1,
        };
        this.triggerFovPulse('expand', {
            amount: this.cinematicConfig.fovPulseAmount * (0.8 + (0.45 * intensity)),
            duration: Math.max(0.55, durationMs / 1000),
        });
    }

    setSeamPhase({
        boundaryId,
        seamPhase = 0,
        envelope = 0,
        direction = 1,
        intensity = 1,
    } = {}) {
        if (!boundaryId) return;
        this.positionSeamBeat = {
            boundaryId,
            seamPhase: THREE.MathUtils.clamp(seamPhase || 0, -1, 1),
            envelope: THREE.MathUtils.clamp(envelope || 0, 0, 1),
            direction: Math.sign(direction) || 1,
            intensity: THREE.MathUtils.clamp(intensity, 0, 1.6),
        };
    }

    clearSeamPhase() {
        this.positionSeamBeat = null;
    }

    triggerVistaBeat({
        chapterId = 1,
        durationMs = 1350,
        intensity = 1,
    } = {}) {
        this.vistaBeat = {
            active: true,
            chapterId,
            startTime: performance.now(),
            duration: Math.max(1, durationMs),
            intensity: THREE.MathUtils.clamp(intensity, 0, 1.4),
        };
    }

    _getChapterAtProgress(progress) {
        for (let index = 0; index < this.chapterPositions.length - 1; index += 1) {
            const start = this.chapterPositions[index];
            const end = this.chapterPositions[index + 1] ?? 1;
            if (progress >= start && progress <= end) {
                return index + 1;
            }
        }
        return 1;
    }

    _getSeamSlowdown(progress) {
        let slowdown = 1;
        for (let index = 1; index < this.chapterPositions.length - 1; index += 1) {
            const boundary = this.chapterPositions[index];
            if (!Number.isFinite(boundary)) continue;
            const distance = Math.abs(progress - boundary);
            const window = 0.03;
            if (distance <= window) {
                const local = THREE.MathUtils.smoothstep(distance / window, 0, 1);
                slowdown = Math.min(slowdown, THREE.MathUtils.lerp(0.48, 1, local));
            }
        }
        return slowdown;
    }

    updateTravelCurrent(deltaTime) {
        if (!this.config.idleAutoDrift || this.mode !== 'follow') {
            return;
        }

        const dt = Math.max(0, deltaTime || 0);
        if (dt <= 0 || this.targetPosition >= this.config.maxPosition) {
            return;
        }

        const chapterId = this._getChapterAtProgress(this.currentPosition);
        const profile = getChapterProfile(chapterId);
        const worldSpeed = ACT_TRAVEL_SPEEDS[profile.act] ?? ACT_TRAVEL_SPEEDS[ODYSSEY_ACTS.LIVING];
        const seamSlowdown = this._getSeamSlowdown(this.currentPosition);
        const beatSurge = this.directorCamera.beatPulse * this.config.beatDriftScale;
        const energyLift = this.directorCamera.energy * 0.28;
        const autoVelocity = (worldSpeed / this.travelModel.pathLength)
            * this.config.autoDriftScale
            * (1 + beatSurge + energyLift)
            * seamSlowdown;

        this.travelModel.inputVelocity *= Math.exp(-dt * 2.4);
        const targetVelocity = autoVelocity + this.travelModel.inputVelocity;
        const lerp = 1 - Math.exp(-dt * 2.8);
        this.travelModel.velocity = THREE.MathUtils.lerp(this.travelModel.velocity, targetVelocity, lerp);
        // Cap the manual scroll velocity so a hard flick can't outrun the background chapter
        // render-warm (and stays cinematically readable). autoVelocity is well under this.
        const maxV = this.config.maxScrollVelocity;
        if (maxV > 0) {
            this.travelModel.velocity = THREE.MathUtils.clamp(this.travelModel.velocity, -maxV, maxV);
        }

        if (Math.abs(this.travelModel.velocity) < 1e-5) {
            return;
        }

        this.targetPosition = THREE.MathUtils.clamp(
            this.targetPosition + this.travelModel.velocity * dt,
            this.config.minPosition,
            this.config.maxPosition,
        );
    }

    updateFollow(deltaTime) {
        this.updateTravelCurrent(deltaTime);

        // Lerp current position toward target, then CAP the per-frame step so a far target
        // (a hard wheel flick) can't lurch the camera across the map faster than
        // maxScrollVelocity. This is the real bound on visible scroll speed — it keeps the
        // travel readable and lets the background chapter render-warm stay ahead of the
        // player. (Directed travel uses focus/path modes, not this lerp, so it stays fast.)
        const lerpFactor = 1 - (1 - this.config.followLerpSpeed) ** (deltaTime * 60);
        let nextPosition = THREE.MathUtils.lerp(
            this.currentPosition,
            this.targetPosition,
            lerpFactor,
        );
        const maxV = this.config.maxScrollVelocity;
        if (maxV > 0 && deltaTime > 0) {
            const maxStep = maxV * deltaTime;
            const step = nextPosition - this.currentPosition;
            if (Math.abs(step) > maxStep) {
                nextPosition = this.currentPosition + Math.sign(step) * maxStep;
            }
        }
        this.currentPosition = nextPosition;

        const frameBlend = 1 - Math.exp(-Math.max(0, deltaTime) * 7.2);
        this.updateFollowPosition({
            direct: false,
            positionBlend: frameBlend,
            lookBlend: frameBlend,
        });
    }

    updateFreeCameraBasis() {
        this.freeCameraDirection.set(0, 0, -1).applyQuaternion(this.freeCameraQuaternion).normalize();
        this.freeCameraRight.set(1, 0, 0).applyQuaternion(this.freeCameraQuaternion).normalize();
        this.freeCameraUp.set(0, 1, 0).applyQuaternion(this.freeCameraQuaternion).normalize();
    }

    updateFreeLookTarget() {
        this.updateFreeCameraBasis();
        this.lookAtTarget.copy(this.camera.position).addScaledVector(
            this.freeCameraDirection,
            this.freeCameraState.lookDistance,
        );
    }

    syncFreeCameraFromScene() {
        const direction = this.lookAtTarget.clone().sub(this.camera.position);
        if (direction.lengthSq() < 1e-6) {
            this.camera.getWorldDirection(direction);
        }

        direction.normalize();
        this.camera.updateMatrixWorld(true);
        this.freeCameraQuaternion.copy(this.camera.quaternion).normalize();
        this.freeCameraState.lookDistance = Math.max(
            6,
            this.camera.position.distanceTo(this.lookAtTarget) || this.config.freeCamera.lookDistance,
        );
        this.updateFreeLookTarget();
    }

    findNearestPathPosition(worldPosition, sampleCount = this.config.freeCamera.progressSampleCount) {
        if (!(worldPosition instanceof THREE.Vector3) || !this.pathCurve) {
            return Number.NaN;
        }

        let bestPosition = this.currentPosition;
        let bestDistanceSq = Infinity;
        const samplePoint = new THREE.Vector3();

        for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex += 1) {
            const position = sampleIndex / sampleCount;
            this.getPathDataAt(position, samplePoint);
            const distanceSq = samplePoint.distanceToSquared(worldPosition);
            if (distanceSq < bestDistanceSq) {
                bestDistanceSq = distanceSq;
                bestPosition = position;
            }
        }

        return bestPosition;
    }

    syncFreeProgressFromCamera() {
        this.freeCameraAnchor.copy(this.camera.position).lerp(this.lookAtTarget, 0.35);
        const nearestPosition = this.findNearestPathPosition(this.freeCameraAnchor);
        if (!Number.isFinite(nearestPosition)) {
            return;
        }

        this.currentPosition = nearestPosition;
        this.targetPosition = nearestPosition;
    }

    setFreeMode(enabled = true) {
        if (!enabled) {
            this.setFollowMode();
            return;
        }

        this._cancelActiveAnimation(false);
        this.portalApproach = null;
        this.mode = 'free';
        this.camera.rotation.z = 0;
        this.syncFreeCameraFromScene();
        this.camera.quaternion.copy(this.freeCameraQuaternion);
        this.camera.updateMatrixWorld(true);
        this.syncFreeProgressFromCamera();
    }

    isFreeMode() {
        return this.mode === 'free';
    }

    applyFreeLookDelta(deltaX = 0, deltaY = 0) {
        if (!this.isFreeMode()) {
            return false;
        }

        return this.rotateFreeCamera(
            -deltaX * this.config.freeCamera.lookSensitivity,
            -deltaY * this.config.freeCamera.lookSensitivity,
        );
    }

    rotateFreeCamera(yawDelta = 0, pitchDelta = 0) {
        if (!this.isFreeMode()) {
            return false;
        }

        if (yawDelta !== 0) {
            this.freeCameraTempQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawDelta);
            this.freeCameraQuaternion.multiply(this.freeCameraTempQuat).normalize();
        }

        if (pitchDelta !== 0) {
            this.updateFreeCameraBasis();
            const currentPitch = Math.asin(THREE.MathUtils.clamp(this.freeCameraDirection.y, -1, 1));
            const nextPitch = THREE.MathUtils.clamp(
                currentPitch + pitchDelta,
                -this.config.freeCamera.pitchLimit,
                this.config.freeCamera.pitchLimit,
            );
            const clampedDelta = nextPitch - currentPitch;
            if (clampedDelta !== 0) {
                this.freeCameraTempQuat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), clampedDelta);
                this.freeCameraQuaternion.multiply(this.freeCameraTempQuat).normalize();
            }
        }

        this.camera.rotation.z = 0;
        this.updateFreeLookTarget();
        this.camera.quaternion.copy(this.freeCameraQuaternion);
        this.camera.updateMatrixWorld(true);
        this.syncFreeProgressFromCamera();
        return true;
    }

    moveFreeCamera(localMovement) {
        if (!this.isFreeMode()) {
            return false;
        }

        const movement = localMovement instanceof THREE.Vector3
            ? localMovement
            : new THREE.Vector3(
                Number(localMovement?.x) || 0,
                Number(localMovement?.y) || 0,
                Number(localMovement?.z) || 0,
            );

        if (movement.lengthSq() === 0) {
            return false;
        }

        this.updateFreeCameraBasis();
        this.camera.position.addScaledVector(this.freeCameraRight, movement.x);
        this.camera.position.addScaledVector(FREE_CAMERA_WORLD_UP, movement.y);
        this.camera.position.addScaledVector(this.freeCameraDirection, movement.z);
        this.updateFreeLookTarget();
        this.syncFreeProgressFromCamera();
        return true;
    }

    dollyFree(distance) {
        if (!this.isFreeMode() || !Number.isFinite(distance) || distance === 0) {
            return false;
        }

        return this.moveFreeCamera(new THREE.Vector3(0, 0, distance));
    }

    computeFollowFrame(position) {
        const clampedPosition = THREE.MathUtils.clamp(position, 0, 1);
        const {
            position: pathPoint,
            tangent,
            normal,
            right,
        } = this.getPathDataAt(
            clampedPosition,
            this._framePosition,
            this._frameTangent,
            this._frameNormal,
            this._frameRight,
        );
        const seamWeight = this.getSeamBeatStrength();
        const vistaWeight = this.getVistaBeatStrength();
        const seamDirection = this.positionSeamBeat?.direction || this.seamBeat?.direction || 1;
        const seamIntensity = this.positionSeamBeat?.intensity || this.seamBeat?.intensity || 0;
        const forwardOffset = 1.15 * seamWeight * seamIntensity;
        const vistaPullback = vistaWeight * (2.6 + this.directorCamera.followDistance * 0.08);
        const vistaLift = vistaWeight * 1.85;

        // UNIT A7-CAMERA: smoothed per-chapter framing (path-frame biases).
        const framing = this._activeFraming;

        const gravityBlend = THREE.MathUtils.clamp(1 - Math.abs(tangent.y) * 0.45, 0.35, 0.9);
        const cameraUp = this._frameCameraUp.copy(normal).lerp(PATH_FRAME_GRAVITY_UP, gravityBlend).normalize();
        // Roll-stabilisation (per-chapter): pull the up-vector toward WORLD up so a
        // near-vertical spline can't tilt the horizon. Default worldUp 0 = unchanged.
        const worldUpBlend = THREE.MathUtils.clamp(framing.worldUp ?? 0, 0, 1);
        if (worldUpBlend > 0) {
            cameraUp.lerp(PATH_FRAME_GRAVITY_UP, worldUpBlend).normalize();
        }
        const camPos = this._frameCamPos.copy(pathPoint)
            .addScaledVector(tangent, -(this.directorCamera.followDistance + vistaPullback))
            .addScaledVector(right, this.config.followOffset.x + framing.camRight)
            .addScaledVector(cameraUp, this.config.followOffset.y + vistaLift + framing.camUp)
            .addScaledVector(tangent, framing.camForward);
        if (forwardOffset > 0) {
            camPos.addScaledVector(tangent, forwardOffset * seamDirection);
        }

        const lookAheadDistance = this.cinematicConfig.lookAheadEnabled
            ? this.cinematicConfig.lookAheadDistance
            : 0.01;
        const lookAheadT = THREE.MathUtils.clamp(
            clampedPosition + (lookAheadDistance * (forwardOffset > 0 ? 1.4 : 1) * this.directorCamera.drift)
                + vistaWeight * 0.018,
            0,
            1,
        );
        const { position: lookTarget } = this.getPathDataAt(lookAheadT, this._frameLookTarget, this._frameThrow, this._frameThrow, this._frameThrow);
        if (forwardOffset > 0) {
            lookTarget.addScaledVector(tangent, forwardOffset * 0.45 * seamDirection);
        }
        const climbBias = THREE.MathUtils.clamp((tangent.y + 0.15) * 0.55, 0, 0.65)
            * (framing.climbScale ?? 1);
        lookTarget.addScaledVector(cameraUp, climbBias * (2.5 + this.directorCamera.followDistance * 0.12));

        // UNIT A7-CAMERA: per-chapter look-target re-aim (rule-of-thirds yaw/pitch
        // + down-path bias) so the hero / set piece stays in frame, not the void.
        lookTarget
            .addScaledVector(tangent, framing.lookForward)
            .addScaledVector(right, framing.lookRight)
            .addScaledVector(cameraUp, framing.lookUp);

        lookTarget.add(this.getLookAtOffset(clampedPosition));

        return {
            camPos,
            lookTarget,
            tangent,
            normal: cameraUp,
            right,
        };
    }

    updateFollowPosition(options = {}) {
        const {
            position = this.currentPosition,
            direct = false,
            positionBlend = 0.1,
            lookBlend = 0.1,
        } = options;

        const { camPos, lookTarget, normal } = this.computeFollowFrame(position);

        if (direct) {
            this.camera.position.copy(camPos);
            this.lookAtTarget.copy(lookTarget);
            this.followCameraUp.copy(normal);
            return;
        }

        this.camera.position.lerp(camPos, positionBlend);
        this.lookAtTarget.lerp(lookTarget, lookBlend);
        this.followCameraUp.lerp(normal, lookBlend).normalize();
    }

    getLookAtOffset(position) {
        if (position >= this.chapter1EndPosition) {
            return this.lookAtOffset.set(0, 0, 0);
        }

        const fadeStart = Math.max(0, this.chapter1EndPosition - CHAPTER_1_LOOK_FADE_RANGE);
        const fade = CHAPTER_1_LOOK_FADE_RANGE > 0
            ? 1 - THREE.MathUtils.smoothstep(position, fadeStart, this.chapter1EndPosition)
            : 1;

        // UNIT A7-CAMERA: Earth Core no longer stares straight down a lava shaft.
        // The smoothed framing's downLookScale collapses the legacy top-down offset
        // to a gentle drop, leaving a low 3/4 forward "descending into the core" aim
        // (the forward/up reframing is applied in computeFollowFrame).
        const downScale = this._activeFraming?.downLookScale ?? 1;
        return this.lookAtOffset.copy(CHAPTER_1_LOOK_DOWN).multiplyScalar(fade * downScale);
    }

    updateAnimation() {
        const elapsed = performance.now() - this.animationStartTime;
        let t = Math.min(elapsed / this.animationDuration, 1);

        // Ease in-out
        t = t < 0.5
            ? 4 * t * t * t
            : 1 - (-2 * t + 2) ** 3 / 2;

        // Interpolate position
        this.camera.position.lerpVectors(
            this.animationStartPos,
            this.animationEndPos,
            t,
        );

        // Interpolate look-at
        this.lookAtTarget.lerpVectors(
            this.animationStartLookAt,
            this.animationEndLookAt,
            t,
        );

        if (Number.isFinite(this.animationStartFov) && Number.isFinite(this.animationEndFov)) {
            this.camera.fov = THREE.MathUtils.lerp(
                this.animationStartFov,
                this.animationEndFov,
                t,
            );
            this.camera.updateProjectionMatrix();
        }

        // End animation
        if (elapsed >= this.animationDuration) {
            this.isAnimating = false;
            this.animationKind = null;
            if (this.mode === 'follow') {
                this.currentPosition = this.targetPosition;
            }
            this._resolveAnimation(true);
        }
    }

    updatePathTravel() {
        const travel = this.pathTravel;
        if (!travel?.active) return;

        const elapsed = performance.now() - travel.startTime;
        const rawProgress = Math.min(elapsed / travel.duration, 1);
        const easedProgress = rawProgress < 0.5
            ? 4 * rawProgress * rawProgress * rawProgress
            : 1 - ((-2 * rawProgress + 2) ** 3) / 2;
        const nextPosition = THREE.MathUtils.lerp(
            travel.startPosition,
            travel.endPosition,
            easedProgress,
        );

        const crossings = this.getCrossedBoundaryIds(travel.lastPosition, nextPosition);
        crossings.forEach((boundaryId) => {
            if (!travel.crossedBoundaryIds.includes(boundaryId)) {
                travel.crossedBoundaryIds.push(boundaryId);
            }
        });

        travel.lastPosition = nextPosition;
        travel.progress = easedProgress;
        this.currentPosition = nextPosition;
        this.targetPosition = travel.endPosition;
        this.updateFollowPosition({ position: nextPosition, direct: true });

        if (elapsed >= travel.duration) {
            this.currentPosition = travel.endPosition;
            this.targetPosition = travel.endPosition;
            this.updateFollowPosition({ position: travel.endPosition, direct: true });
            this._finishPathTravel(true);
        }
    }

    updatePortalApproach() {
        const approach = this.portalApproach;
        if (!approach?.active) return;

        const elapsed = performance.now() - approach.startTime;
        const t = Math.min(elapsed / approach.duration, 1);
        const alignEnd = 220 / 650;
        const dollyEnd = 520 / 650;
        const tmpPosition = new THREE.Vector3();

        let roll = 0;

        if (t <= alignEnd) {
            const local = THREE.MathUtils.smoothstep(t / alignEnd, 0, 1);
            this.camera.position.lerpVectors(
                approach.startPosition,
                approach.lockPosition,
                local,
            );
            this.lookAtTarget.lerpVectors(
                approach.startLookAt,
                approach.targetPosition,
                0.55 + (local * 0.45),
            );
            this.camera.fov = THREE.MathUtils.lerp(approach.startFov, 56, local);
            roll = 0.01 * local;
        } else if (t <= dollyEnd) {
            const local = (t - alignEnd) / (dollyEnd - alignEnd);
            const accel = local ** 2.2;
            tmpPosition.lerpVectors(approach.lockPosition, approach.midPosition, accel);
            tmpPosition.addScaledVector(approach.cameraRight, Math.sin(local * Math.PI) * 0.22);
            tmpPosition.addScaledVector(approach.cameraUp, Math.sin(local * Math.PI * 0.7) * 0.09);
            this.camera.position.copy(tmpPosition);
            this.lookAtTarget.lerpVectors(
                approach.startLookAt,
                approach.targetPosition,
                THREE.MathUtils.clamp(0.82 + (local * 0.18), 0, 1),
            );
            this.camera.fov = THREE.MathUtils.lerp(56, 44, accel);
            roll = 0.012 + (Math.sin(local * Math.PI) * 0.016);
        } else {
            const local = (t - dollyEnd) / (1 - dollyEnd);
            const suction = 1 - ((1 - local) ** 3);
            tmpPosition.lerpVectors(approach.midPosition, approach.finalPosition, suction);
            tmpPosition.addScaledVector(
                approach.approachDirection,
                -0.18 * (1 - local) * (0.7 + approach.targetRadius),
            );
            this.camera.position.copy(tmpPosition);
            this.lookAtTarget.copy(approach.targetPosition);
            this.camera.fov = THREE.MathUtils.lerp(44, 34, suction);
            roll = THREE.MathUtils.lerp(0.024, 0, suction);
        }

        // Deferred to after lookAt() in update() so the suction roll survives (masterplan §2 #6).
        this._pendingViewRoll = roll;
        this.camera.updateProjectionMatrix();

        if (elapsed >= approach.duration) {
            this.camera.position.copy(approach.finalPosition);
            this.lookAtTarget.copy(approach.targetPosition);
            this.camera.fov = 34;
            this.camera.updateProjectionMatrix();
            this.portalApproach.active = false;
        }
    }

    updateSeamBeat() {
        if (!this.seamBeat?.active) return;

        const elapsed = performance.now() - this.seamBeat.startTime;
        if (elapsed >= this.seamBeat.duration) {
            this.seamBeat.active = false;
        }
    }

    updateVistaBeat() {
        if (!this.vistaBeat?.active) return;

        const elapsed = performance.now() - this.vistaBeat.startTime;
        if (elapsed >= this.vistaBeat.duration) {
            this.vistaBeat.active = false;
        }
    }

    getSeamBeatStrength() {
        if (this.positionSeamBeat) {
            return this.positionSeamBeat.envelope * (this.positionSeamBeat.intensity || 0);
        }

        if (!this.seamBeat?.active) return 0;

        const elapsed = performance.now() - this.seamBeat.startTime;
        const t = THREE.MathUtils.clamp(elapsed / this.seamBeat.duration, 0, 1);
        const envelope = Math.sin(t * Math.PI);
        return envelope * (this.seamBeat.intensity || 0);
    }

    getVistaBeatStrength() {
        if (!this.vistaBeat?.active) return 0;

        const elapsed = performance.now() - this.vistaBeat.startTime;
        const t = THREE.MathUtils.clamp(elapsed / this.vistaBeat.duration, 0, 1);
        const intro = THREE.MathUtils.smoothstep(t, 0, 0.28);
        const outro = 1 - THREE.MathUtils.smoothstep(t, 0.68, 1);
        return intro * outro * (this.vistaBeat.intensity || 0);
    }

    getCrossedBoundaryIds(startPosition, endPosition) {
        if (!Number.isFinite(startPosition) || !Number.isFinite(endPosition) || startPosition === endPosition) {
            return [];
        }

        const low = Math.min(startPosition, endPosition);
        const high = Math.max(startPosition, endPosition);
        const direction = Math.sign(endPosition - startPosition);
        const crossed = this.chapterBoundaryPositions.filter(({ position }) => {
            if (direction > 0) {
                return position > low && position <= high;
            }
            return position >= low && position < high;
        });

        if (direction < 0) {
            crossed.reverse();
        }

        return crossed.map(({ id }) => id);
    }

    _finishPathTravel(success) {
        if (!this.pathTravel?.active) return;

        this.pathTravel.active = false;
        this.isAnimating = false;
        this.animationKind = null;
        this.mode = 'follow';
        this._resolveAnimation(success);
    }

    _cancelActiveAnimation(resolveValue = false) {
        if (this.pathTravel?.active) {
            this.pathTravel.active = false;
        }

        if (this.isAnimating) {
            this.isAnimating = false;
            this.animationKind = null;
        }

        this._resolveAnimation(resolveValue);
    }

    _resolveAnimation(value) {
        if (typeof this.animationResolve === 'function') {
            const resolve = this.animationResolve;
            this.animationResolve = null;
            resolve(value);
        }
    }

    /**
     * Set mode to follow
     */
    setFollowMode(options = {}) {
        this._cancelActiveAnimation(false);
        this.mode = 'follow';
        this.portalApproach = null;
        this.camera.rotation.z = 0;
        this.camera.up.copy(FREE_CAMERA_WORLD_UP);

        const nextPosition = THREE.MathUtils.clamp(
            Number.isFinite(options.position) ? options.position : this.currentPosition,
            this.config.minPosition,
            this.config.maxPosition,
        );
        this.currentPosition = nextPosition;
        this.targetPosition = nextPosition;
        this.updateFollowPosition({
            position: nextPosition,
            direct: options.direct !== false,
        });
    }

    /**
     * Get current position along path
     * @returns {number} 0 to 1
     */
    getCurrentPosition() {
        return this.currentPosition;
    }

    getTravelState() {
        return {
            active: !!this.pathTravel?.active,
            progress: this.pathTravel?.progress ?? 1,
            direction: this.pathTravel?.direction ?? Math.sign(this.targetPosition - this.currentPosition),
            crossedBoundaryIds: [...(this.pathTravel?.crossedBoundaryIds ?? [])],
            animationKind: this.animationKind,
            seamStrength: this.getSeamBeatStrength(),
        };
    }

    /**
     * Set target position directly
     * @param {number} position - 0 to 1
     */
    setTargetPosition(position) {
        this.targetPosition = THREE.MathUtils.clamp(
            position,
            this.config.minPosition,
            this.config.maxPosition,
        );
    }

    setCurrentPosition(position) {
        const clampedPosition = THREE.MathUtils.clamp(
            position,
            this.config.minPosition,
            this.config.maxPosition,
        );
        this.currentPosition = clampedPosition;
        this.targetPosition = clampedPosition;
    }
}

export default OdysseyCameraController;
