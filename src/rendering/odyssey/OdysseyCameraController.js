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
import {
    URBAN_STAGE_HERO,
    computeStageBasis,
    urbanIgnition,
} from './composition/odyssey-stage-frame.js';
import {
    seamHalfWidth,
    seamWindowAt,
    smooth01,
    smoother01,
} from './transitions/odyssey-seam-schedule.js';
import { resolveBlackHoleFallCamera, resolveBlackHoleFallExit } from './transitions/odyssey-black-hole-fall.js';

const DEFAULT_CHAPTER_POSITIONS = ODYSSEY_PATH_DATA.chapterPositions || [0, 1];
const CHAPTER_1_LOOK_DOWN = new THREE.Vector3(0, -26, 0);
const CHAPTER_1_LOOK_FADE_RANGE = 0.035;
// THE EYE STARTED INSIDE THE LAVA (user report 2026-08-12; recorded but never actioned in the
// Act I plan's own Phase 0 table, "birth - below the lava lake plane").
//
// Nothing in this controller ever bounded the camera's world Y. The eye is pulled BACKWARDS
// along the path tangent by `followDistance` (see computeFollowFrame), and chapter 1 is a
// near-vertical shaft, so "backwards" is straight DOWN: -24 * 0.789 ~= -19 units at p=0, which
// the +6.7 followOffset.y and +4.6 camUp lifts do not repay. Replaying the shipped LUT maths:
// the eye bottoms out at y = -40.86 at the steady followDistance 24, and at **-44.01** during
// the first second while the director is still lerping down from the constructor's 28 - i.e.
// up to 4 units UNDER the lake, and `startPosition` is p=0, so the Odyssey's very first frame
// was inside the lava. It dips again around p ~ 0.005 on the spline's S-bend.
//
// Fixed as a hard positional floor rather than by retuning camUp, because the violation is
// worst exactly when followDistance is still time-varying at boot, and a tuned constant cannot
// cover a moving target. Scoped to chapter 1: this function serves all eight chapters, and
// chapter 7's group legitimately sits at negative Y.
const CHAPTER_1_LAVA_SURFACE_Y = -40; // world; chapterRange.start.y (-30) + LAVA_LAKE_Y (-10)
const CHAPTER_1_EYE_CLEARANCE = 6; // eye stays this far above the lava, never in or on it
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
    // SHOT LANGUAGE in real camera terms (2026-10). The look/cam keys above are WORLD-UNIT
    // offsets, so at a ~85 u aim distance a lookUp of 2.5 is ~1.7 deg — effectively centred.
    // These are applied AFTER the target is resolved, as true angular moves:
    //   fovOffset  degrees added to the director's per-act base FOV (crane = widen)
    //   pitchDeg   tilt of the look direction about the camera's right axis (+ = up)
    //   yawDeg     pan of the look direction about the camera's up axis (+ = right)
    fovOffset: 0,
    pitchDeg: 0,
    yawDeg: 0,
    //   rollDeg    roll about the view axis, applied after lookAt (+ = counter-clockwise).
    //              Only chapter 7's fall authors it (caught by the hole's spin); zero for
    //              players who prefer reduced motion.
    rollDeg: 0,
    // STAGE FRAME (2026-10). A set-piece chapter authored in a fixed basis (the Urban
    // corridor) needs the camera to share that basis, or the camera's own path frame rolls
    // the set on screen. stage (0..1) blends the camera up-vector, right-vector and dolly
    // direction toward the chapter's stage basis; stageAim (0..1) blends the look DIRECTION
    // toward the stage forward (a one-point-perspective shot down the set). 0 = untouched.
    stage: 0,
    stageAim: 0,
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
        // Horizon levelling (2026-08). Ch5 hands over at worldUp 0.5 (its exit framing),
        // which leaves the camera rolled ~11.6 deg at the boundary; ch6 used to drop
        // straight back to worldUp 0 and roll 23.3 deg — a visible lurch right where the
        // carried summit ring + aurora are still on screen. 0.55 enters at 10.5 deg (i.e.
        // continuous with Ch5) and settles to ~5.7 deg. Space needs no hard-level horizon,
        // so this stops short of Ch5's 0.92 and keeps some path-frame character.
        worldUp: 0.55,
    }),
    // 7 — Black Hole (transcendence): preserve the strong entry composition — keep
    // the accretion disk biased off dead-centre (slightly low-right) for the run.
    7: Object.freeze({
        lookRight: 3.2,
        lookUp: -1.4,
        camRight: -1.6,
        camUp: 1.4,
    }),
    // 8 — Urban Encore (transcendence): the camera rides the CITY'S stage frame (the
    // corridor basis the canyon is built in) so the towers stand upright on screen; before
    // this the path frame rolled the city -34 deg at entry and -90 deg at the journey end.
    // A one-point-perspective dolly straight down the canyon toward the Retrosun, tilted
    // down over the wet street. The finale crane lives in resolveChapter8Framing().
    8: Object.freeze({
        stage: 1,
        stageAim: 0.82,
        climbScale: 0,
        camForward: -3.0,
        camUp: 1.5,
        pitchDeg: -9,
    }),
});

// Exponential blend rate (per second) for easing between per-chapter framings.
const FRAMING_BLEND_RATE = 2.4;

const FRAMING_KEYS = Object.freeze([
    'lookForward', 'lookRight', 'lookUp', 'camRight', 'camUp', 'camForward', 'downLookScale',
    'worldUp', 'climbScale', 'fovOffset', 'pitchDeg', 'yawDeg', 'stage', 'stageAim', 'rollDeg',
]);

// Chapters whose set piece is authored in a fixed stage basis (see `stage` above).
const STAGE_FRAME_CHAPTERS = Object.freeze([8]);

// setCurrentPosition() jumps larger than this (path progress) are teleports: the smoothed
// camera state snaps on the next update (see setCurrentPosition).
const TELEPORT_SNAP_THRESHOLD = 5e-4;

// ── ARRIVAL SHOT (journey end) ──────────────────────────────────────────────────────
// Reaching p=1 used to simply stop the camera. Once the camera has ARRIVED (progress
// >= start) and the player is idle, a slow held move takes over: the eye orbits the final
// node by up to `orbitDeg` around the stage up while easing in, and the aim settles onto
// the spire placed on the right third (the Retrosun behind it). Any input releases it.
export const ARRIVAL_SHOT = Object.freeze({
    start: 0.997, // path progress
    idleSeconds: 1.2, // no scroll input for this long before the shot begins
    blendInSeconds: 3.5,
    orbitSeconds: 26, // time to complete the orbit (eased), then it holds
    orbitDeg: 24,
    pushIn: 0.1, // fraction of the eye->node distance closed over the orbit
    heroYawDeg: -21, // aim this far LEFT of the spire = spire on the right third
    heroPitchDeg: -6, // keeps the final node in the lower frame while the crown rides high
});

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
    // 1.05 -> 1.40: THE OPENING SHOT NOW SHOWS THE FLOOR IT IS BORN FROM (user request
    // 2026-08-12: "an angle so that you see the first level orb as well as the lava floor").
    // With the eye floored above the lava the view still pitched 23.7 degrees UP, which put
    // the lake behind the bottom edge entirely (the nearest floor sample projected to NDC y
    // -1.75). Deepening the start-only down-look levels the opening to ~0 degrees: measured
    // NDC, the first orb sits at (-0.21, +0.29) and the lava reads across the lower half
    // (-0.70 at 15 units out, -0.35 at 30, -0.14 at 80). This value is start-only — the
    // framing lerps to the chapter base (0.65) over in-chapter progress 0.12 -> 0.34, so the
    // ascent is untouched.
    downLookScale: 1.4,
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
//   • LATE   (1.0): tilt UP AGAIN toward the brightening surface       = the breach
// ⚠️ LATE USED TO TILT DOWN (lookUp -6, camUp -2: "toward the reef / indigo abyss"), which was
// the dive of an older layout. The live rail ASCENDS through the end of chapter 2 and breaks
// the surface at the 2->3 seam, so the down-tilt aimed the eye at the abyss in the last
// seconds before the breach and the seam then had to swing it up to chapter 3's level shot.
// Seamless pass (2026-10-02): the late beat looks UP toward the light the rail is climbing
// into, and lands close to chapter 3's entry framing so the breach needs no swing at all.
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
        lookForward: 2.0,
        lookUp: 4.0,
        camUp: 0.6,
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
/**
 * A LIFT AND TWO SHOTS (2026-10-03, owner: improve chapter 5's experience and composition).
 *
 * A real-camera replay of the climb found the chapter's middle was ONE frame held for 0.2 of
 * progress. The base arc above levels the view to the horizon and past it (in game: pitch 37 deg
 * at lift-off, 6 by p 0.45, -5 at p 0.55, -19 passing the summit) while the rail keeps climbing,
 * so the node the camera stood on sat ON the top edge of the screen, the next one above it, the
 * summit was cut off by the top edge and the rail ran dead centre. The player could not see where
 * the climb went.
 *
 * ⚠️ SOLVE THESE ON THE IN-GAME CAMERA: the BEYOND profile's `drift` (0.7) shortens the look-ahead
 * and lowers the pitch by ~9 deg against a bare controller (drift 1). The first lift (14 deg) was
 * solved without it and left every node on the top edge in the first in-game capture.
 *
 * These are ANGULAR moves on top of the base arc. Windows are chapter-local progress ([from, to]
 * ramps in and out); all are zero at lift-off and zero again before the 5->6 hand-off begins:
 *   - `lift`     tilts the view up the face for the whole climb: the node underfoot at y ~0.5,
 *                the next at 0.6-0.8, the summit mid-frame, and — passing the summit, where the
 *                base arc looked DOWN — a level look across the world from the shoulder (L34).
 *   - `lookOut`  at L31: pan right off the face, across the open island, on a wider lens.
 *   - `summit`   at L32-L33: pan back past the rail onto the summit, on a longer lens; it looms.
 */
export const CHAPTER_5_SHOTS = Object.freeze({
    lift: Object.freeze({
        in: Object.freeze([0.17, 0.25]), out: Object.freeze([0.80, 0.90]), pitchDeg: 23, yawDeg: 0, fovOffset: 0,
    }),
    lookOut: Object.freeze({
        in: Object.freeze([0.29, 0.36]), out: Object.freeze([0.41, 0.47]), pitchDeg: -4, yawDeg: 16, fovOffset: 4,
    }),
    summit: Object.freeze({
        in: Object.freeze([0.43, 0.49]), out: Object.freeze([0.64, 0.72]), pitchDeg: 0, yawDeg: -12, fovOffset: -4,
    }),
});
const CHAPTER_5_SHOT_LIST = Object.values(CHAPTER_5_SHOTS);

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
    for (let i = 0; i < CHAPTER_5_SHOT_LIST.length; i += 1) {
        const shot = CHAPTER_5_SHOT_LIST[i];
        const weight = THREE.MathUtils.smoothstep(clamped, shot.in[0], shot.in[1])
            * (1 - THREE.MathUtils.smoothstep(clamped, shot.out[0], shot.out[1]));
        out.pitchDeg += shot.pitchDeg * weight;
        out.yawDeg += shot.yawDeg * weight;
        out.fovOffset += shot.fovOffset * weight;
    }
    return out;
}

// ── Chapter 8 Urban — FINALE CRANE arc ────────────────────────────────────────────
// ONE clock with the env + post (composition/odyssey-stage-frame.js urbanIgnition): the
// arrival is a dark, level dolly down the canyon; as the spire ignites (local 0.35->0.9) the
// camera rises and TILTS UP the megastructure while the lens widens, so the ignition, the
// crane and the bloom swell land together. Real angular moves (pitch/FOV), not the former
// 4.5 u lift with a constant downward pitch. Returns a full framing record (total lerp).
const CHAPTER_8_BASE = CHAPTER_FRAMING_OVERRIDES[8];
export const CHAPTER_8_CRANE = Object.freeze({
    camUp: 9.0,
    pitchDeg: 12,
    fovOffset: 6,
    stageAim: 0.92,
});
function resolveChapter8Framing(t) {
    const crane = urbanIgnition(THREE.MathUtils.clamp(t, 0, 1));
    const out = { ...DEFAULT_CHAPTER_FRAMING, ...CHAPTER_8_BASE };
    out.camUp = THREE.MathUtils.lerp(CHAPTER_8_BASE.camUp ?? 0, CHAPTER_8_CRANE.camUp, crane);
    out.pitchDeg = THREE.MathUtils.lerp(CHAPTER_8_BASE.pitchDeg ?? 0, CHAPTER_8_CRANE.pitchDeg, crane);
    out.fovOffset = THREE.MathUtils.lerp(0, CHAPTER_8_CRANE.fovOffset, crane);
    out.stageAim = THREE.MathUtils.lerp(CHAPTER_8_BASE.stageAim ?? 0, CHAPTER_8_CRANE.stageAim, crane);
    return out;
}

// THE FALL (chapter 7, 2026-10-02): a gentle roll (frame dragging) and a widening FOV (speed)
// across the plunge into the black hole, both sin-shaped from the chapter's start to where the 7->8
// window opens (transitions/odyssey-black-hole-fall.js), so they are exactly zero at both seams.
const CH7_FALL_EXIT = resolveBlackHoleFallExit(DEFAULT_CHAPTER_POSITIONS) ?? 0.82;
let reducedMotionPreferred = null;
function prefersReducedMotion() {
    if (reducedMotionPreferred === null) {
        reducedMotionPreferred = typeof window !== 'undefined'
            && !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    }
    return reducedMotionPreferred;
}
/** Test / settings hook: force the reduced-motion preference (null = re-read the media query). */
export function setOdysseyCameraReducedMotion(value) {
    reducedMotionPreferred = value === null ? null : !!value;
}
function resolveChapter7Framing(t) {
    const fall = resolveBlackHoleFallCamera(t, CH7_FALL_EXIT);
    return {
        ...resolveChapterFraming(7),
        rollDeg: prefersReducedMotion() ? 0 : fall.rollDeg,
        fovOffset: fall.fovOffset,
    };
}

function resolveChapterFramingForProgress(chapterId, inChapterProgress = 0) {
    if (chapterId === 1) return resolveChapter1Framing(inChapterProgress);
    if (chapterId === 2) return resolveChapter2Framing(inChapterProgress);
    if (chapterId === 3) return resolveChapter3Framing(inChapterProgress);
    if (chapterId === 4) return resolveChapter4Framing(inChapterProgress);
    if (chapterId === 5) return resolveChapter5Framing(inChapterProgress);
    if (chapterId === 7) return resolveChapter7Framing(inChapterProgress);
    if (chapterId === 8) return resolveChapter8Framing(inChapterProgress);
    return resolveChapterFraming(chapterId);
}

export { resolveChapterFramingForProgress };

// Framing keys that re-base the camera's ORIENTATION BASIS (the Urban stage basis, and the
// world-up roll lock). They follow the staggered (coverage) schedule instead of the symmetric
// seam lerp — see resolveJourneyFraming. worldUp is here because a HALF-applied roll lock is
// the one state that is worse than either end: the up-vector is then a moving mix of the path
// normal and gravity, and where the view is steep (4->5 looks ~68 deg up the near-vertical rail)
// that mix sits almost parallel to the view axis, so the image rolled up to 80 deg mid-seam.
// The value is where in the window (0..1, 0.5 = the boundary) the lock completes. worldUp locks
// by the boundary. The STAGE basis by 0.7: the Urban basis sits ~40-60 deg off the black hole's
// near-vertical rail, and squeezing that swing into the first half of a 0.0324 p window swung
// the eye ~8 u per 0.001 p (3x plain travel); at 0.7 the city is ~80 % aligned at the boundary
// — it is fully drawn there, so the residual is a few degrees of roll — and the swing is gentle.
const BASIS_ALIGN_END = Object.freeze({ stage: 0.7, stageAim: 0.7, worldUp: 0.5 });

function chapterAtProgress(progress, chapterPositions) {
    for (let index = 0; index < chapterPositions.length - 1; index += 1) {
        const start = chapterPositions[index];
        const end = chapterPositions[index + 1] ?? 1;
        if (progress >= start && progress <= end) return index + 1;
    }
    return 1;
}

function localChapterProgress(chapterId, progress, chapterPositions) {
    const start = chapterPositions[chapterId - 1];
    const end = chapterPositions[chapterId] ?? 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
    return THREE.MathUtils.clamp((progress - start) / (end - start), 0, 1);
}

/**
 * THE JOURNEY FRAMING — the target framing as a CONTINUOUS function of progress.
 *
 * Seamless pass (2026-10-02). The target used to be "the framing of whichever chapter the
 * camera is in", so it SWITCHED at every boundary and a 2.4/s wall-clock ease hid the switch.
 * Hidden badly: 4->5 swapped ch4's end pose (lookUp +4.6, worldUp 0) for ch5's entry pose
 * (lookUp -40, worldUp 0.92) and the eye swooped from dirY 0.94 to 0.69 inside 0.004 p; every
 * other seam stepped 3-30 u of eye and up to 78 deg of roll in one frame of a teleport capture.
 *
 * Now, inside a seam window (the same window the chapter fades use), the framing is
 * lerp(source chapter's framing, target chapter's framing, smootherstep(t)), each side
 * evaluated at its own in-chapter progress (the source holds its exit pose past the boundary,
 * the target holds its entry pose before it). At the window edges it equals the plain chapter
 * framing, so it is continuous everywhere and the wall-clock ease is only a lag filter on top.
 *
 * STAGE keys (the Urban corridor basis) use the staggered coverage schedule instead: a stage
 * chapter is fully drawn by the boundary (ChapterEnvironmentManager), so the camera must be on
 * its basis by then — the city used to show through the black hole rolled ~40 deg because the
 * alignment only began AFTER the boundary.
 *
 * @param {number} progress 0..1
 * @param {number[]} chapterPositions live chapter boundaries [0, ..., 1]
 * @returns {object} full framing record (DEFAULT keys + overrides)
 */
export function resolveJourneyFraming(progress, chapterPositions = DEFAULT_CHAPTER_POSITIONS) {
    const seam = seamWindowAt(progress, chapterPositions);
    if (!seam) {
        const chapterId = chapterAtProgress(progress, chapterPositions);
        return resolveChapterFramingForProgress(chapterId, localChapterProgress(chapterId, progress, chapterPositions));
    }
    const src = resolveChapterFramingForProgress(
        seam.source,
        localChapterProgress(seam.source, progress, chapterPositions),
    );
    const dst = resolveChapterFramingForProgress(
        seam.target,
        localChapterProgress(seam.target, progress, chapterPositions),
    );
    const blend = smoother01(seam.t);
    const out = { ...DEFAULT_CHAPTER_FRAMING };
    for (let i = 0; i < FRAMING_KEYS.length; i += 1) {
        const key = FRAMING_KEYS[i];
        const fallback = DEFAULT_CHAPTER_FRAMING[key];
        const a = src[key] ?? fallback;
        const b = dst[key] ?? fallback;
        let w = blend;
        const alignEnd = BASIS_ALIGN_END[key];
        if (alignEnd) {
            // Moving ONTO a stronger basis lock completes early (by `alignEnd` of the window);
            // moving off one holds it until the mirror point (the staggered coverage schedule).
            w = b >= a ? smooth01(seam.t / alignEnd) : 1 - smooth01((1 - seam.t) / alignEnd);
        }
        out[key] = THREE.MathUtils.lerp(a, b, w);
    }
    return out;
}

// ── 6->7 HAIRPIN — the path turns ~170 deg just past the boundary ─────────────────
// The rail doubles back between ~p 0.877 and 0.892 (tangent yaw 65 -> -135 deg in ~35 u), and
// the follow camera swung round with it: the view turned at up to 13 deg per 0.001 p, while
// Gargantua (camera-locked) sat still and the whole starfield whipped past it. The seam
// look-ahead made it worse by aiming INTO the turn from the boundary on.
//
// Inside this window the camera's travel direction is a CHORD of the rail,
// P(p + h(1 - lag)) - P(p - h(1 + lag)), instead of the local tangent. A chord is exact on a
// straight run; across a U-turn it rotates over the chord's whole span rather than the turn's,
// and because the U also CLIMBS, the chord rolls over the top of the turn instead of swinging
// flat across it — measured on the live spline: peak view rotation 13.1 -> ~6 deg per 0.001 p,
// spread over the whole window (pitch peaks ~63 deg at the apex; Gargantua is camera-locked,
// so the hero holds its place in frame through it). The eye placement, the look target and the
// lateral biases all use it. h is 0 at both window edges (h = H sin(pi u)), so the chord IS the
// tangent there and the frame is continuous; the lag keeps the camera a little behind the
// turn rather than anticipating it. The window starts AT the boundary — ch6's dive onto the
// omen (pinned by odyssey-ch6-hero-framing.test.js) is untouched — and is sized in 6->7 seam
// half-widths, so a re-layout carries it.
export const HAIRPIN_67 = Object.freeze({
    boundaryIndex: 6, // chapterPositions[6] = the 6->7 boundary
    startSeams: 0, // window starts AT the boundary
    endSeams: 2.07, // ... and ends this many seam half-widths past it (~0.046 p, 116 u)
    chordSeams: 1.35, // peak chord half-span H, in seam half-widths (~0.03 p, 76 u)
    lag: 0.25, // chord centre trails the camera by lag * h
    rampIn: 0.2, // weight ramps at the edges: the look-ahead point already sits round the bend at
    rampOut: 0.2, // the boundary, so a short ramp swung the aim ~20 u per 0.001 p onto the chord
});

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
        // Minimum world Y for the eye while inside chapter 1 (see the constant's note).
        // Settable so earth-core can publish the real plane if the chapter is ever re-anchored.
        this.chapterOneEyeFloorY = CHAPTER_1_LAVA_SURFACE_Y + CHAPTER_1_EYE_CLEARANCE;
        this.startPosition = Number.isFinite(options.startPosition)
            ? options.startPosition
            : (this.levelPositions[0] ?? this.chapterPositions[0] ?? 0);

        // State
        this.mode = 'follow'; // 'follow' | 'free' | 'focus'
        this.currentPosition = this.startPosition; // Start framed toward Level 1
        this.targetPosition = this.startPosition;
        // Travel frontier — 1 means "no limit". Only the board lowers it.
        this.travelFrontier = 1;
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
        // Arrival shot state (see ARRIVAL_SHOT).
        this._arrivalTime = 0;
        this._arrivalWeight = 0;
        this._arrivalPivot = new THREE.Vector3();
        this._arrivalHero = new THREE.Vector3();
        this._arrivalScratch = new THREE.Vector3();
        this._arrivalQuat = new THREE.Quaternion();
        // Dev/capture preview: ?odysseyArrivalPreview=<seconds> pre-ages the arrival shot; a
        // bare flag (=1, what the capture harness's --url-flag passes) jumps to its settled end.
        this._arrivalPreview = (() => {
            if (typeof window === 'undefined') return 0;
            try {
                const raw = new URLSearchParams(window.location?.search || '').get('odysseyArrivalPreview');
                const v = Number(raw);
                if (!Number.isFinite(v) || v <= 0) return 0;
                return v <= 1 ? ARRIVAL_SHOT.orbitSeconds + 2 : v;
            } catch {
                return 0;
            }
        })();

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
        // Stage-frame / angular-framing scratch (computeFollowFrame), never reallocated.
        this._frameRightBlend = new THREE.Vector3();
        this._frameDolly = new THREE.Vector3();
        this._frameAim = new THREE.Vector3();
        this._frameAxis = new THREE.Vector3();
        this._frameLookTangent = new THREE.Vector3();
        this._frameQuat = new THREE.Quaternion();
        // 6->7 hairpin chord (see HAIRPIN_67), never reallocated.
        this._frameChord = new THREE.Vector3();
        this._frameChordA = new THREE.Vector3();
        this._frameTravel = new THREE.Vector3();
        this._frameTravelRight = new THREE.Vector3();
        this._frameReach = new THREE.Vector3();
        this._hairpinWindow = undefined;

        // UNIT A7-CAMERA: smoothed per-chapter framing. `_activeFraming` is eased
        // toward the resolved framing of the chapter under the camera so boundary
        // changes never snap. Seeded from the start chapter so the first frame is
        // already framed correctly.
        this._activeFraming = resolveJourneyFraming(this.currentPosition, this.chapterPositions);
        this._framingInitialized = false;

        // Configuration
        this.config = {
            // Raised well ABOVE the path (was -1.4, slightly below) so the camera looks
            // down on the journey at an elevated 3/4 angle; pulled back via followDistance.
            followOffset: new THREE.Vector3(0, 7, 18),
            followLerpSpeed: 0.03,
            // Input SENSITIVITY: how far one wheel/mousepad delta moves the target. Mousepads emit
            // a flood of small deltas, so a high value makes a single swipe run the target far ahead
            // and the camera race across the map (the "way too fast" feel). Lowered 0.5 -> 0.15 ->
            // 0.09; tunable in-game via the board controller (?odysseyScrollSpeed=).
            scrollSpeed: Number.isFinite(options.scrollSpeed) ? options.scrollSpeed : 0.09,
            // Cap on manual scroll velocity (progress units/sec). A hard wheel flick used to
            // build unbounded velocity and teleport across the map; this keeps the travel readable
            // AND lets the background render-warm + per-chapter LOD stay ahead of the player. The
            // gentle cinematic auto-drift is well under this, so it only bites flicks. Lowered
            // 0.4 -> 0.15 to tame super-fast mousepad scrolling; tunable via the board controller
            // (?odysseyMaxScroll=). NOTE: normal swipes rarely reach this cap — scrollSpeed above is
            // the primary "how fast does the mousepad scroll" lever; this only bounds hard flicks.
            maxScrollVelocity: Number.isFinite(options.maxScrollVelocity) ? options.maxScrollVelocity : 0.15,
            focusDistance: 10,
            minPosition: 0, // Allow scrolling all the way to Level 1
            maxPosition: 1, // Allow scrolling all the way to the end
            magneticRadius: 0.004,
            magneticFriction: 0.45,
            idleAutoDrift: options.idleAutoDrift !== false,
            // TRAVEL FRONTIER (see odyssey-travel-frontier.js): the furthest progress the player
            // is currently allowed to reach, so travel can never enter a chapter that is not
            // prepared. 1 = no limit; the board pushes a lower value while a chapter ahead is
            // still building. Applied ONLY to the two continuous player-travel paths — manual
            // scroll and the cinematic auto-drift — never to travelToPosition/focus, which are
            // deliberate navigation (entering a level) rather than travel.
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
            // BREATHING (2026-10). The old sway/bob added `amp * dt * 2` to WORLD x/y every
            // frame, BEFORE the 7.2/s follow lerp pulled the eye back — about 0.05 u of
            // motion survived: invisible. Breathing is now a camera-relative offset applied
            // AFTER the follow (and removed again before the next follow step, so it never
            // accumulates), scaled to the follow distance and built from incommensurate
            // sines so it never visibly loops. Amplitudes are fractions of followDistance
            // (36 u in the finale -> ~0.4 u sway, ~0.3 u bob: felt, never seasick).
            swayEnabled: true,
            swayAmplitude: 0.011, // x followDistance, camera-right
            swayFrequency: 0.071, // Hz of the dominant term (slow, dreamlike)

            bobEnabled: true,
            bobAmplitude: 0.008, // x followDistance, camera-up
            bobFrequency: 0.093,

            surgeAmplitude: 0.006, // x followDistance, along the view (a slow breath in/out)

            // Camera roll breathing (very subtle tilt)
            rollEnabled: true,
            rollAmplitude: 0.003, // Radians (~0.17 degrees)
            rollFrequency: 0.25, // Very slow

            // FOV pulse for chapter transitions — ONE hump (fast attack, long release) that
            // starts from the CURRENT fov, so a restart never snaps.
            fovPulseEnabled: true,
            baseFov: 60,
            fovPulseAmount: 6, // Degrees at the peak of the hump
            fovPulseDuration: 1.5, // Seconds for the whole pulse
            fovPulseAttack: 0.32, // fraction of the duration spent widening

            // Look-ahead bias (anticipate path direction)
            lookAheadEnabled: true,
            // ⚠️ THIS IS A PATH FRACTION, SO WAVE 1A's ASCENT CHANGED WHAT IT BUYS.
            // `p` is arc-normalised over the whole curve; the ascent took the total
            // 1767.65 -> 2393.89, so a fixed 0.02 started looking 35% FURTHER ahead in world
            // terms everywhere in the journey — measured as a framing shift at the board's
            // opening frame, where chapter 1's starting level slid to ndcY -1.02 against a
            // -1.0 floor. Scaled by 0.7384 to keep the same world look-ahead it was tuned for.
            // Note `followDistance` needs no such treatment: it is already in world units.
            // RE-SCALED for Wave 1C's flyby (2393.89 -> 2532.66): 0.02 * 1767.65/2532.66.
            lookAheadDistance: 0.01396, // world-equivalent of the pre-ascent 0.02
        };

        // Breathing animation state
        this.breatheTime = 0;
        this._breathOffset = new THREE.Vector3();
        // 0..1 envelope: reset whenever breathing is suspended (focus/zoom animations, portal,
        // free camera) and eased back in, so it never resumes at full amplitude in one frame.
        this._breathWeight = 1;
        this._breathApplied = false;
        this._breathForward = new THREE.Vector3();
        this._breathRight = new THREE.Vector3();
        this._breathUp = new THREE.Vector3();
        this.fovPulseStartFov = camera?.fov ?? 60;
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
        this._stageFrame = undefined; // re-derived lazily against the new curve
        this._hairpinWindow = undefined;
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
        this._stageFrame = undefined;
        this._hairpinWindow = undefined;
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
            this.maxTravelPosition(),
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
        // Take last frame's breathing offset back out so the follow/animation maths always
        // starts from the un-breathed pose (the offset is re-applied after the follow).
        if (this._breathApplied) {
            this.camera.position.sub(this._breathOffset);
            this._breathApplied = false;
        }
        // Desired view-axis roll for this frame, applied AFTER lookAt() (which would otherwise
        // rebuild the quaternion and discard any camera.rotation.z written before it). Set by
        // applyBreathingMotion() and updatePortalApproach(); 0 = no roll. (masterplan §2 #6)
        this._pendingViewRoll = 0;
        const teleported = this._teleportPending === true;
        this._teleportPending = false;
        if (teleported) {
            Object.assign(this.directorCamera, this.directorCameraTarget);
            this.cinematicConfig.baseFov = this.directorCamera.fovBase;
            this._framingInitialized = false; // updateChapterFraming snaps to the target
        }
        this.updateDirectorCamera(deltaTime);
        this.updateChapterFraming(deltaTime);

        this.updateArrivalShot(deltaTime);

        if (this.pathTravel?.active) {
            this.updatePathTravel();
        } else if (this.portalApproach?.active) {
            this.updatePortalApproach();
        } else if (this.isAnimating) {
            this.updateAnimation();
        } else if (this.mode === 'follow') {
            if (teleported) {
                this.updateFollowPosition({ direct: true });
            } else {
                this.updateFollow(deltaTime);
            }
        }

        this.updateSeamBeat();
        this.updateVistaBeat();

        // Apply cinematic breathing effects
        this.applyBreathingMotion(deltaTime);

        // Keep the baseline framing synced to the OdysseyDirector camera profile.
        this.applyBaseFov(deltaTime, teleported);

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
        this.applyFramingRoll();
    }

    /**
     * The active framing's authored roll (chapter 7's fall), about the view axis, after lookAt.
     * Public so harnesses that drive lookAt themselves (the ch7 playground bench) can apply it.
     */
    applyFramingRoll() {
        const rollDeg = this._activeFraming?.rollDeg ?? 0;
        if (rollDeg) this.camera.rotateZ(THREE.MathUtils.degToRad(rollDeg));
    }

    /**
     * Apply subtle breathing motion (sway, bob, surge, roll) as a camera-relative offset.
     */
    applyBreathingMotion(deltaTime = 0) {
        const cc = this.cinematicConfig;
        const t = this.breatheTime;
        const seamWeight = this.getSeamBeatStrength();
        const vistaWeight = this.getVistaBeatStrength();
        const swayScale = this.directorCamera.sway * (1 + this.directorCamera.energy * 0.12);
        const bobScale = this.directorCamera.bob * (1 + this.directorCamera.beatPulse * 0.08);
        const driftScale = this.directorCamera.drift;

        // Don't apply during rapid animations (focus/zoom). Resetting the envelope here is what
        // makes the hand-back gentle: without it, the end of every focus or level-entry zoom
        // switched breathing on at full amplitude — a 0.4-0.6 u one-frame twitch (pre-merge review).
        if (this.mode === 'free' || this.portalApproach?.active || (this.isAnimating && this.mode === 'focus')) {
            this._breathWeight = 0;
            return;
        }
        this._breathWeight += (1 - this._breathWeight) * (1 - Math.exp(-Math.max(0, deltaTime) * 1.5));
        const breath = this._breathWeight;

        // Camera-relative basis from the current pose (forward to the look target).
        const forward = this._breathForward.copy(this.lookAtTarget).sub(this.camera.position);
        if (forward.lengthSq() > 1e-8 && (cc.swayEnabled || cc.bobEnabled)) {
            forward.normalize();
            const right = this._breathRight.crossVectors(forward, this.followCameraUp || FREE_CAMERA_WORLD_UP);
            if (right.lengthSq() > 1e-8) {
                right.normalize();
                const up = this._breathUp.crossVectors(right, forward).normalize();
                const reach = Math.max(4, this.directorCamera.followDistance || 0);
                const calm = (1 - seamWeight * 0.6) * (1 - vistaWeight * 0.4);
                const tau = Math.PI * 2;
                const fs = cc.swayFrequency;
                const fb = cc.bobFrequency;
                // Three incommensurate sines per axis: a slow dominant drift, a lighter
                // counter-drift and a faint quick shimmer.
                const swayWave = Math.sin(t * tau * fs) * 0.6
                    + Math.sin(t * tau * fs * 1.93 + 1.3) * 0.3
                    + Math.sin(t * tau * fs * 4.41 + 2.1) * 0.1;
                const bobWave = Math.sin(t * tau * fb + 0.7) * 0.6
                    + Math.sin(t * tau * fb * 2.17 + 2.4) * 0.3
                    + Math.sin(t * tau * fb * 3.71 + 0.2) * 0.1;
                const surgeWave = Math.sin(t * tau * fs * 0.61 + 4.0);
                const sway = cc.swayEnabled ? swayWave * cc.swayAmplitude * reach * swayScale * calm * breath : 0;
                const bob = cc.bobEnabled ? bobWave * cc.bobAmplitude * reach * bobScale * calm * breath : 0;
                const surge = surgeWave * (cc.surgeAmplitude ?? 0) * reach * driftScale * calm * breath;
                this._breathOffset.set(0, 0, 0)
                    .addScaledVector(right, sway)
                    .addScaledVector(up, bob)
                    .addScaledVector(forward, surge);
                this.camera.position.add(this._breathOffset);
                this._breathApplied = true;
            }
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
        // A few chapters stage a target framing that varies with the camera's progress
        // THROUGH the chapter (a live act-arc), not a single static override:
        //   • ch2 Deep Ocean — three-act vertical reveal (tilt up -> level -> tilt up to the breach)
        //   • ch3 Surface     — hero-tree lookAt strengthening at the mid-chapter beat
        //   • ch5 Sky Drift    — summit hold -> aurora canopy -> atmosphere-edge crane
        //   • ch8 Urban        — finale CRANE up the igniting spire over the last ~18%
        // Every other chapter uses its static override. Across a seam the two sides are
        // lerped by progress (resolveJourneyFraming), so the target itself never steps; the
        // exponential ease below only filters it.
        const target = resolveJourneyFraming(this.currentPosition, this.chapterPositions);
        const active = this._activeFraming;

        // Snap on the very first frame (avoids a visible ease-in from defaults on load).
        if (!this._framingInitialized) {
            this._framingInitialized = true;
            Object.assign(active, target);
            return;
        }

        const lerp = 1 - Math.exp(-Math.max(0, deltaTime) * FRAMING_BLEND_RATE);
        for (let i = 0; i < FRAMING_KEYS.length; i += 1) {
            const key = FRAMING_KEYS[i];
            const fallback = DEFAULT_CHAPTER_FRAMING[key];
            active[key] = THREE.MathUtils.lerp(active[key] ?? fallback, target[key] ?? fallback, lerp);
        }
    }

    /**
     * The 6->7 hairpin window in progress (see HAIRPIN_67), cached; null if the layout has no
     * 6->7 boundary.
     * @returns {{start:number, end:number, h:number}|null}
     */
    _getHairpinWindow() {
        if (this._hairpinWindow !== undefined) return this._hairpinWindow;
        const boundary = this.chapterPositions[HAIRPIN_67.boundaryIndex];
        if (!Number.isFinite(boundary) || this.chapterPositions.length < HAIRPIN_67.boundaryIndex + 2) {
            this._hairpinWindow = null;
            return null;
        }
        const w = seamHalfWidth(HAIRPIN_67.boundaryIndex);
        this._hairpinWindow = {
            start: boundary + HAIRPIN_67.startSeams * w,
            end: Math.min(1, boundary + HAIRPIN_67.endSeams * w),
            h: HAIRPIN_67.chordSeams * w,
        };
        return this._hairpinWindow;
    }

    /**
     * How strongly the camera rides the rail CHORD instead of its tangent at `progress`
     * (0 outside the 6->7 hairpin window). Writes the chord direction into `_frameChord`.
     * @param {number} progress
     * @returns {number} 0..1
     */
    _resolveHairpinDamp(progress) {
        const win = this._getHairpinWindow();
        if (!win || progress <= win.start || progress >= win.end) return 0;
        const u = (progress - win.start) / (win.end - win.start);
        const weight = smooth01(u / HAIRPIN_67.rampIn)
            * (1 - smooth01((u - (1 - HAIRPIN_67.rampOut)) / HAIRPIN_67.rampOut));
        if (!(weight > 1e-4)) return 0;
        const h = win.h * Math.sin(Math.PI * u);
        const throwaway = this._frameThrow;
        const ahead = this.getPathDataAt(
            progress + h * (1 - HAIRPIN_67.lag),
            this._frameChord,
            throwaway,
            throwaway,
            throwaway,
        ).position;
        const behind = this.getPathDataAt(
            progress - h * (1 + HAIRPIN_67.lag),
            this._frameChordA,
            throwaway,
            throwaway,
            throwaway,
        ).position;
        ahead.sub(behind);
        if (ahead.lengthSq() < 1e-8) return 0;
        ahead.normalize();
        return weight;
    }

    /**
     * The fixed stage basis of the nearest stage-frame chapter (the Urban corridor), derived
     * from the SAME function the env builds its corridor with. Cached; rebuilt on re-layout.
     * @returns {{forward:THREE.Vector3, right:THREE.Vector3, up:THREE.Vector3}|null}
     */
    _getStageFrame() {
        if (this._stageFrame !== undefined) return this._stageFrame;
        const chapterId = STAGE_FRAME_CHAPTERS[0];
        const tStart = this.chapterPositions[chapterId - 1];
        const tEnd = this.chapterPositions[chapterId] ?? 1;
        this._stageFrame = computeStageBasis(this.pathCurve, tStart, tEnd) || null;
        if (this._stageFrame) {
            // The set piece is anchored at the chapter's path-range centre (env convention).
            const a = this.getPathDataAt(tStart).position;
            const b = this.getPathDataAt(tEnd).position;
            this._stageFrame.center = a.add(b).multiplyScalar(0.5);
        }
        return this._stageFrame;
    }

    /**
     * Director base FOV + the active chapter's angular fovOffset (crane widening).
     * @returns {number}
     */
    _resolveBaseFov() {
        const base = this.directorCamera.fovBase;
        const offset = this._activeFraming?.fovOffset ?? 0;
        return Number.isFinite(offset) ? base + offset : base;
    }

    /**
     * Arrival-shot clock (see ARRIVAL_SHOT): accumulates while the camera rests at the
     * journey's end in follow mode with no recent input; any travel/input releases it.
     * @param {number} deltaTime
     */
    updateArrivalShot(deltaTime) {
        const dt = Math.max(0, deltaTime || 0);
        const lastInput = this.travelModel.lastInputAt || 0;
        const idleFor = lastInput > 0 ? (performance.now() - lastInput) / 1000 : Infinity;
        const resting = this.mode === 'follow'
            && !this.isAnimating
            && !this.pathTravel?.active
            && this.currentPosition >= ARRIVAL_SHOT.start
            && this.targetPosition >= ARRIVAL_SHOT.start;
        // The orbit clock is FROZEN while the shot fades out and reset only once it has fully
        // faded: resetting it on the first non-resting frame dropped the 24-degree orbit and the
        // push-in in a single frame (a ~16 u eye pop when travel starts — pre-merge review).
        // `target` follows `resting`, so the weight eases out at the release rate below.
        if (resting && idleFor >= ARRIVAL_SHOT.idleSeconds) {
            this._arrivalTime = Math.max(this._arrivalTime + dt, this._arrivalPreview);
        } else if (!resting && this._arrivalWeight <= 1e-4) {
            this._arrivalTime = 0;
        }
        const target = (resting && this._arrivalTime > 0)
            ? THREE.MathUtils.smoothstep(this._arrivalTime, 0, ARRIVAL_SHOT.blendInSeconds)
            : 0;
        // Release quickly when the player moves again, ease in slowly.
        const rate = target > this._arrivalWeight ? 1.2 : 3.0;
        this._arrivalWeight = this._arrivalPreview > 0
            ? target
            : THREE.MathUtils.lerp(this._arrivalWeight, target, 1 - Math.exp(-dt * rate));
    }

    /**
     * Apply the arrival orbit/push-in/hero aim to a resolved follow frame (in place).
     * @private
     */
    _applyArrivalShot(camPos, lookTarget, cameraUp) {
        const weight = this._arrivalWeight;
        if (!(weight > 1e-4)) return;
        const stage = this._getStageFrame();
        const throwaway = this._frameThrow;
        const pivot = this.getPathDataAt(1, this._arrivalPivot, throwaway, throwaway, throwaway).position;
        const orbitT = THREE.MathUtils.clamp(this._arrivalTime / ARRIVAL_SHOT.orbitSeconds, 0, 1);
        const orbitEase = orbitT * orbitT * orbitT * (orbitT * (orbitT * 6 - 15) + 10);
        const axis = stage?.up || cameraUp;

        // Orbit the eye around the final node + push in.
        const offset = this._arrivalScratch.copy(camPos).sub(pivot);
        this._arrivalQuat.setFromAxisAngle(axis, THREE.MathUtils.degToRad(ARRIVAL_SHOT.orbitDeg) * orbitEase * weight);
        offset.applyQuaternion(this._arrivalQuat).multiplyScalar(1 - ARRIVAL_SHOT.pushIn * orbitEase * weight);
        camPos.copy(pivot).add(offset);

        // Hero aim: the spire on the right third, a touch above it.
        if (!stage) return;
        const hero = this._resolveArrivalHero(stage);
        if (!hero) return;
        const aim = this._frameAim.copy(hero).sub(camPos);
        const distance = Math.max(1, lookTarget.distanceTo(camPos));
        aim.normalize();
        this._arrivalQuat.setFromAxisAngle(axis, -THREE.MathUtils.degToRad(ARRIVAL_SHOT.heroYawDeg));
        aim.applyQuaternion(this._arrivalQuat);
        const pitchAxis = this._frameAxis.crossVectors(aim, axis);
        if (pitchAxis.lengthSq() > 1e-8) {
            pitchAxis.normalize();
            this._arrivalQuat.setFromAxisAngle(pitchAxis, THREE.MathUtils.degToRad(ARRIVAL_SHOT.heroPitchDeg));
            aim.applyQuaternion(this._arrivalQuat);
        }
        const current = this._arrivalScratch.copy(lookTarget).sub(camPos).normalize();
        current.lerp(aim, weight).normalize();
        lookTarget.copy(camPos).addScaledVector(current, distance);
    }

    /**
     * World position of the urban hero (spire) from the stage basis + chapter centre.
     * @private
     */
    _resolveArrivalHero(stage) {
        if (!stage?.center) return null;
        const [lx, ly, lz] = URBAN_STAGE_HERO;
        return this._arrivalHero.copy(stage.center)
            .addScaledVector(stage.right, lx)
            .addScaledVector(stage.up, ly)
            .addScaledVector(stage.forward, -lz);
    }

    applyBaseFov(deltaTime, snap = false) {
        if (this.mode !== 'follow') {
            return;
        }
        if (this.fovPulseActive || this.portalApproach?.active || (this.isAnimating && this.mode === 'focus')) {
            return;
        }

        const targetFov = this._resolveBaseFov();
        if (!Number.isFinite(targetFov)) return;

        const lerp = snap ? 1 : 1 - Math.exp(-Math.max(0, deltaTime) * 2.2);
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
        const base = this._resolveBaseFov();

        // ONE hump: a quick smooth widen, then a long smooth release. (The old curve hit
        // sin(pi * t / 0.4) — a full hump by t=0.4 — then a SECOND hump on the way down,
        // and it started from the base FOV, so a re-trigger snapped.) The pulse rides on
        // a carrier that eases from the FOV it started at to the live base, so restarts
        // and base changes are continuous.
        const attack = THREE.MathUtils.clamp(cc.fovPulseAttack ?? 0.32, 0.05, 0.95);
        const smooth = (x) => x * x * (3 - 2 * x);
        const envelope = t < attack
            ? smooth(t / attack)
            : 1 - smooth((t - attack) / (1 - attack));
        const carrier = THREE.MathUtils.lerp(this.fovPulseStartFov, base, smooth(Math.min(1, t / 0.6)));
        const direction = this.fovPulseType === 'expand' ? 1 : -0.5;
        this.camera.fov = carrier + envelope * this.fovPulseAmount * direction;
        this.camera.updateProjectionMatrix();

        // End pulse (envelope and carrier have both landed on the base: no snap)
        if (t >= 1) {
            this.fovPulseActive = false;
            this.camera.fov = base;
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
        this.fovPulseStartFov = Number.isFinite(this.camera?.fov) ? this.camera.fov : this._resolveBaseFov();
        this.fovPulseType = type;
        this.fovPulseAmount = options.amount ?? this.cinematicConfig.fovPulseAmount;
        this.fovPulseDuration = options.duration ?? this.cinematicConfig.fovPulseDuration;
    }

    /**
     * Notify camera of chapter change (for transition effects)
     * @param {number} chapterId
     */
    onChapterChange(chapterId) {
        // NO FOV PULSE AT A CHAPTER CHANGE (seamless pass, 2026-10-02). The pulse was a
        // wall-clock +7-8 deg widen fired as the camera ENTERED a seam (triggerChapterSeam)
        // and again here at the boundary whenever the seam took longer than 2.5 s to cross —
        // which, at travel speed, it always did. A lens breathing on a timer is a non-diegetic
        // beat: invisible in a position capture, a hiccup in play. The per-act FOV still moves,
        // continuously, through the director's seam-blended fovBase.
        this.lastChapterId = chapterId;
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
        // (The FOV pulse that used to fire here is gone — see onChapterChange. This is now
        // bookkeeping for the position-driven beat only.)
    }

    /**
     * Position-driven seam phase, set by the board every frame the camera is inside a seam.
     * Every seam beat the camera plays (the forward lean, the look-ahead stretch, the vista
     * breath) reads THIS envelope — sin(pi * t) across the seam window — so each one is 0 at
     * the window edges and continuous in progress, never a wall-clock event.
     * @param {object} phase
     * @param {string} phase.boundaryId
     * @param {number} [phase.seamPhase] -1..1 across the window
     * @param {number} [phase.envelope] 0..1, peaks at the boundary
     * @param {number} [phase.direction] travel direction sign
     * @param {number} [phase.intensity] seam intensity (fx preset)
     * @param {number} [phase.vista] vista-breath strength for this seam (0 = none)
     */
    setSeamPhase({
        boundaryId,
        seamPhase = 0,
        envelope = 0,
        direction = 1,
        intensity = 1,
        vista = undefined,
    } = {}) {
        if (!boundaryId) return;
        this.positionSeamBeat = {
            boundaryId,
            seamPhase: THREE.MathUtils.clamp(seamPhase || 0, -1, 1),
            envelope: THREE.MathUtils.clamp(envelope || 0, 0, 1),
            direction: Math.sign(direction) || 1,
            intensity: THREE.MathUtils.clamp(intensity, 0, 1.6),
            vista: Number.isFinite(vista) ? THREE.MathUtils.clamp(vista, 0, 1.4) : null,
        };
    }

    clearSeamPhase() {
        this.positionSeamBeat = null;
    }

    /**
     * Legacy vista trigger. The vista breath is driven by the seam envelope now
     * (getVistaBeatStrength); this only records a default strength for seam phases that do
     * not pass their own, and never starts a timer.
     */
    triggerVistaBeat({
        chapterId = 1,
        intensity = 1,
    } = {}) {
        this.vistaBeat = {
            active: false,
            chapterId,
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
        // Stop integrating at the frontier too, so drift velocity does not accumulate against
        // a wall and then lurch the moment the chapter ahead becomes ready.
        if (dt <= 0 || this.targetPosition >= this.maxTravelPosition()) {
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
            this.maxTravelPosition(),
        );
    }

    /**
     * The furthest position continuous travel may currently reach: the journey end, or the
     * board's travel frontier when a chapter ahead is not yet prepared.
     * @returns {number} max travel progress
     */
    maxTravelPosition() {
        const frontier = Number.isFinite(this.travelFrontier) ? this.travelFrontier : 1;
        return Math.min(this.config.maxPosition, frontier);
    }

    /**
     * Set the travel frontier (see odyssey-travel-frontier.js). Clamps the TARGET only — never
     * currentPosition — so a frontier that retreats behind the player stops travel rather than
     * yanking them backwards.
     * @param {number} frontier max reachable progress, or 1 for no limit
     */
    setTravelFrontier(frontier) {
        this.travelFrontier = Number.isFinite(frontier) ? frontier : 1;
        if (this.targetPosition > this.travelFrontier) {
            this.targetPosition = Math.max(this.currentPosition, this.travelFrontier);
        }
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

        // 6->7 HAIRPIN: ride the rail's chord, not its tangent (see HAIRPIN_67). `travel` and
        // `travelRight` are the tangent/right everywhere else, so the frame is untouched there.
        const hairpin = this._resolveHairpinDamp(clampedPosition);
        let travel = tangent;
        let travelRight = right;
        if (hairpin > 0) {
            travel = this._frameTravel.copy(tangent).lerp(this._frameChord, hairpin).normalize();
            travelRight = this._frameTravelRight.crossVectors(travel, normal);
            if (travelRight.lengthSq() > 1e-8) travelRight.normalize();
            else travelRight = right;
        }

        // UNIT A7-CAMERA: smoothed per-chapter framing (path-frame biases).
        const framing = this._activeFraming;

        const gravityBlend = THREE.MathUtils.clamp(1 - Math.abs(travel.y) * 0.45, 0.35, 0.9);
        const cameraUp = this._frameCameraUp.copy(normal).lerp(PATH_FRAME_GRAVITY_UP, gravityBlend).normalize();
        // Roll-stabilisation (per-chapter): pull the up-vector toward WORLD up so a
        // near-vertical spline can't tilt the horizon. Default worldUp 0 = unchanged.
        const worldUpBlend = THREE.MathUtils.clamp(framing.worldUp ?? 0, 0, 1);
        if (worldUpBlend > 0) {
            cameraUp.lerp(PATH_FRAME_GRAVITY_UP, worldUpBlend).normalize();
        }
        // STAGE FRAME: share the set piece's fixed basis (up / right / dolly axis). With
        // stage 0 every vector below is the untouched path-frame value.
        const stageWeight = THREE.MathUtils.clamp(framing.stage ?? 0, 0, 1);
        const stageAimWeight = THREE.MathUtils.clamp(framing.stageAim ?? 0, 0, 1);
        const stage = (stageWeight > 0 || stageAimWeight > 0) ? this._getStageFrame() : null;
        let eyeRight = travelRight;
        let dolly = travel;
        if (stage && stageWeight > 0) {
            cameraUp.lerp(stage.up, stageWeight).normalize();
            eyeRight = this._frameRightBlend.copy(travelRight).lerp(stage.right, stageWeight).normalize();
            dolly = this._frameDolly.copy(travel).lerp(stage.forward, stageWeight).normalize();
        }
        const camPos = this._frameCamPos.copy(pathPoint)
            .addScaledVector(dolly, -(this.directorCamera.followDistance + vistaPullback))
            .addScaledVector(eyeRight, this.config.followOffset.x + framing.camRight)
            .addScaledVector(cameraUp, this.config.followOffset.y + vistaLift + framing.camUp)
            .addScaledVector(dolly, framing.camForward);
        if (forwardOffset > 0) {
            camPos.addScaledVector(dolly, forwardOffset * seamDirection);
        }

        // Chapter 1's lava floor. Placed here, at the one point where the eye position is
        // finalised, so every entry that reaches the rail inherits it - the follow lerp,
        // travelToPosition's direct seek, setFollowMode, applyLayout and the capture harness.
        // `Math.max` keeps the position continuous; it only binds for p < ~0.006, where the
        // eye would otherwise be in the lake. The LOOK target is deliberately not clamped:
        // gazing down into the lava is the chapter's opening image ("born from lava").
        // Free/spectator mode writes camera.position directly and is intentionally left
        // unbounded - it is an authoring tool (OdysseyLayoutEditor) and must reach anywhere.
        let eyeLift = 0;
        if (clampedPosition < this.chapter1EndPosition
            && Number.isFinite(this.chapterOneEyeFloorY)) {
            eyeLift = Math.max(0, this.chapterOneEyeFloorY - camPos.y);
            camPos.y += eyeLift;
        }

        const lookAheadDistance = this.cinematicConfig.lookAheadEnabled
            ? this.cinematicConfig.lookAheadDistance
            : 0.01;
        // The seam stretches the look-ahead by up to 40 %, CONTINUOUSLY with the seam envelope.
        // (It used to switch x1.4 on the first frame forwardOffset was > 0 — a ~14 u aim jump
        // at every seam entry and exit, measured 30-32 u of look-target step per 0.001 p.)
        // The vista breath adds a little reach (was 0.018 p = 45 u, which at 6->7 aimed the
        // boundary frame straight into the hairpin's far leg).
        const seamStretch = 1 + 0.4 * Math.min(1, seamWeight);
        const rawLookAheadT = clampedPosition
            + (lookAheadDistance * seamStretch * this.directorCamera.drift)
            + vistaWeight * 0.006;
        const lookAheadT = THREE.MathUtils.clamp(rawLookAheadT, 0, 1);
        const { position: lookTarget, tangent: lookTangent } = this.getPathDataAt(
            lookAheadT,
            this._frameLookTarget,
            this._frameLookTangent,
            this._frameThrow,
            this._frameThrow,
        );
        // Past the journey's end the look-ahead used to CLAMP onto the final node, so the aim
        // collapsed toward the camera's own feet over the last ~1.4% of the path. Continue the
        // look target along the end tangent instead (world-equivalent distance).
        if (rawLookAheadT > 1) {
            lookTarget.addScaledVector(lookTangent, (rawLookAheadT - 1) * this.travelModel.pathLength);
        }
        // HAIRPIN: the look-ahead point lies on the far side of the turn; aim along the chord at
        // the same reach instead, blended by the same weight as the eye.
        if (hairpin > 0) {
            const reach = lookTarget.distanceTo(pathPoint);
            this._frameReach.copy(pathPoint).addScaledVector(travel, reach);
            lookTarget.lerp(this._frameReach, hairpin);
        }
        if (forwardOffset > 0) {
            lookTarget.addScaledVector(travel, forwardOffset * 0.45 * seamDirection);
        }
        const climbBias = THREE.MathUtils.clamp((travel.y + 0.15) * 0.55, 0, 0.65)
            * (framing.climbScale ?? 1);
        lookTarget.addScaledVector(cameraUp, climbBias * (2.5 + this.directorCamera.followDistance * 0.12));

        // UNIT A7-CAMERA: per-chapter look-target re-aim (rule-of-thirds yaw/pitch
        // + down-path bias) so the hero / set piece stays in frame, not the void.
        lookTarget
            .addScaledVector(travel, framing.lookForward)
            .addScaledVector(travelRight, framing.lookRight)
            .addScaledVector(cameraUp, framing.lookUp);

        lookTarget.add(this.getLookAtOffset(clampedPosition));

        // STAGE AIM: blend the look DIRECTION toward the stage forward (distance preserved).
        if (stage && stageAimWeight > 0) {
            const aim = this._frameAim.copy(lookTarget).sub(camPos);
            const distance = aim.length();
            if (distance > 1e-4) {
                aim.divideScalar(distance).lerp(stage.forward, stageAimWeight).normalize();
                lookTarget.copy(camPos).addScaledVector(aim, distance);
            }
        }

        // ANGULAR SHOT LANGUAGE: pan (yaw) about the camera up, then tilt (pitch) about the
        // camera right — real degrees, independent of the aim distance.
        const yawDeg = framing.yawDeg ?? 0;
        const pitchDeg = THREE.MathUtils.clamp(framing.pitchDeg ?? 0, -75, 75);
        if (yawDeg !== 0 || pitchDeg !== 0) {
            const aim = this._frameAim.copy(lookTarget).sub(camPos);
            const distance = aim.length();
            if (distance > 1e-4) {
                aim.divideScalar(distance);
                if (yawDeg !== 0) {
                    this._frameQuat.setFromAxisAngle(cameraUp, -THREE.MathUtils.degToRad(yawDeg));
                    aim.applyQuaternion(this._frameQuat);
                }
                if (pitchDeg !== 0) {
                    const axis = this._frameAxis.crossVectors(aim, cameraUp);
                    if (axis.lengthSq() > 1e-8) {
                        axis.normalize();
                        this._frameQuat.setFromAxisAngle(axis, THREE.MathUtils.degToRad(pitchDeg));
                        aim.applyQuaternion(this._frameQuat);
                    }
                }
                lookTarget.copy(camPos).addScaledVector(aim, distance);
            }
        }

        // ARRIVAL SHOT (journey end, idle): orbit + push-in + hero aim, weighted.
        if (this._arrivalWeight > 1e-4) {
            this._applyArrivalShot(camPos, lookTarget, cameraUp);
        }

        // The floor TRANSLATES the eye; it must not re-aim it. Lifting the eye against a
        // fixed look target would rotate the view downward, and the chapter's opening look
        // is already pushed 26 units down (CHAPTER_1_LOOK_DOWN) — that combination swung the
        // First Heart out of the top of frame (NDC y 2.08, caught by
        // earth-core-environment.test.js). Raising the target by the same amount preserves
        // the view DIRECTION exactly, so the opening composition is unchanged and the camera
        // simply sits higher.
        if (eyeLift > 0) lookTarget.y += eyeLift;

        return {
            camPos,
            lookTarget,
            tangent,
            normal: cameraUp,
            right: eyeRight,
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
        this._tmpApproachPosition = this._tmpApproachPosition || new THREE.Vector3();
        const tmpPosition = this._tmpApproachPosition;

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
        // Position-driven now (getVistaBeatStrength); nothing runs on the clock.
    }

    /**
     * Seam beat strength, from the POSITION envelope only. The wall-clock fallback (a sin hump
     * over beatDurationMs from seam entry) is gone: it was the only thing left that could move
     * the camera in a frame where progress did not.
     * @returns {number}
     */
    getSeamBeatStrength() {
        if (!this.positionSeamBeat) return 0;
        return this.positionSeamBeat.envelope * (this.positionSeamBeat.intensity || 0);
    }

    /**
     * THE VISTA BREATH — the camera eases back and up as it crosses a boundary so the new
     * chapter opens wide. It used to be a 1.45 s wall-clock beat fired at the active-chapter
     * flip (the board's onChapterChange), so it began on a step and never appeared in a
     * capture. Now it is the seam envelope squared: 0 at the window edges, peak at the
     * boundary, identical at any travel speed.
     * @returns {number}
     */
    getVistaBeatStrength() {
        const seam = this.positionSeamBeat;
        if (!seam) return 0;
        const strength = Number.isFinite(seam.vista) ? seam.vista : (this.vistaBeat?.intensity ?? 0.9);
        return seam.envelope * seam.envelope * strength;
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
        // A TELEPORT (not travel — travel never comes through here) settles every smoothed
        // camera state on the next update instead of easing in from wherever the camera was:
        // framing, director distance/FOV, follow pose. Measured 2026-10-01: the chapter
        // capture harness teleports between stations and its settle advances only ~0.1–0.5 s
        // of camera time, so every capture photographed a half-blended framing/FOV.
        if (Math.abs(clampedPosition - this.currentPosition) > TELEPORT_SNAP_THRESHOLD) {
            this._teleportPending = true;
        }
        this.currentPosition = clampedPosition;
        this.targetPosition = clampedPosition;
    }
}

export default OdysseyCameraController;
