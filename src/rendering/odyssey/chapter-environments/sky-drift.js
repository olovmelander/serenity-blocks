/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Sky Drift Environment - Chapter 5 Visual Theme
 *
 * Theme: "Drifting THROUGH a luminous cloud cathedral toward a warm low sun" — the
 * bright, hazy, sun-anchored counterpoint to Space's vacuum. STRICTLY no stars /
 * planets / galaxy / dark space objects: the path threads BETWEEN distinct billowing
 * cloud strata that part to reveal a single warm on-camera Mie sun casting visible
 * god-ray fans + silver-linings, with a cool teal→violet aurora HERO curtain arching
 * across the upper frame. Warm sun + cool aurora = the two-hero colour story.
 *
 * The former cosmic objects (spiral galaxy, solar-eclipse + dark moon, nebulae,
 * nebula veil, banded planets, starfield) read as dark "bruise" blobs against the
 * bright sky and broke the no-space identity, so they have been DELETED. The warm
 * glow they carried is repurposed into an on-camera SUN-glow sprite stack coincident
 * with the baked dome sun.
 *
 * WebGPU: this live chapter runs on THREE.WebGPURenderer; all visuals use the TSL
 * NodeMaterial builders in sky-drift.tsl.js (sky gradient + boosted sun, sun-glow
 * sprite, cloud strata, god-ray fans, aurora curtain, near-foreground wisps). The
 * shared uTime/uEnergy uniforms are TSL uniform() nodes whose `.value` the update
 * loop ticks. The cloud-deck break sprites + lights stay as canvas-glow Sprites /
 * lights (they run on three/webgpu as-is).
 */

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { getActiveOdysseyChapterPositions, getChapterPathRange } from '../path-utils.js';
import {
    createSkyGradientTSL,
    createSunGlowTSL,
    createCloudBreakShaftTSL,
    createCloudStrataTSL,
    createAuroraRibbonsTSL,
    createSkyWispTSL,
    createLenticularCloudTSL,
    createNoctilucentVeilTSL,
    createIceCrystalsTSL,
    SKY_DRIFT_SUN_DIR,
} from './sky-drift.tsl.js';
import { createCanonicalMountainRangeTSL } from './shared/canonical-mountain-range.js';
import { createCloudSeaDeckTSL } from './mountain-peaks.tsl.js';

/**
 * Sky Drift environment configuration
 */
export const SKY_DRIFT_CONFIG = {
    id: 5,
    name: 'sky-drift',
    yStart: 500,
    yEnd: 750,
    colors: {
        primary: 0x1a1a2e,
        secondary: 0x16213e,
        tertiary: 0x533483,
        accent: 0x0f3460,
        background: 0x0a0a14,
    },
};

// SEAM 5->6 ("the aurora just disappears with a pop"). The aurora is now ever-present
// through Ch5, and the manager group-opacity crossfade can't reach its NodeMaterial (alpha
// flows through opacityNode/uOpacity, not material.opacity). Across the LAST stretch of Ch5
// into the Sky→Space boundary we fade the shared aurora uOpacity 1->0 so the curtain recedes
// gracefully (the fog/sky COLOUR lerp Sky->Space is owned by ChapterEnvironmentManager's
// smootherstep'd seam, widened to seamWidth 0.03 in chapter-profile so it never snaps).
// Creative plan ch5 item 3: shrunk 0.34 → 0.15 — the corona climax now peaks BEFORE
// the portal (~80% via the staged dusk ramp), so the recede band only needs the final
// stretch; the long fade was part of why the aurora never read mid-chapter.
// The aurora is world-locked deep ahead and the camera never passes it in Ch6, so it must
// LINGER and dissolve as the camera moves on (not pop). Hold it fully present past the
// boundary, then ease it out over a long tail — timed to the manager's 5→6 env carry so the
// curtain and the inherited summit chain recede together. Bands are fractions of the SPACE
// span (ch6→ch7) so the recede tracks the actual Ch6 travel, not the shorter Ch5 span.
const SKY_AURORA_EXIT_HOLD_BAND = 0.4; // fraction of Space span the aurora stays full past the boundary
const SKY_AURORA_EXIT_TAIL_BAND = 0.85; // fraction of Space span by which the aurora has receded
// Keep the inherited Ch4 summit chain fully readable until it is genuinely outside the
// forward composition. The old -0.08 threshold faded while the peak was still just off
// the edge of frame during the Sky crane.
const SUMMIT_RING_BEHIND_FADE_START_DOT = -0.25;
const SUMMIT_RING_BEHIND_FADE_END_DOT = -0.55;

const summitRingCameraPosition = new THREE.Vector3();
const summitRingForward = new THREE.Vector3();
const summitRingTarget = new THREE.Vector3();
const summitRingToTarget = new THREE.Vector3();

function smoothstep01(value) {
    const t = THREE.MathUtils.clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
}

/**
 * Resolve the 5->6 aurora recede opacity (1->0) across the back of Chapter 5. Outside the
 * band (or without progress) returns 1 so the curtain reads fully in-chapter / standalone.
 * @param {number} progress global Odyssey progress (0..1), or null.
 * @param {number[]} [chapterPositions] active chapter-start progresses.
 * @returns {number} 0..1 aurora opacity
 */
export function resolveSkyDriftAuroraExitOpacity(
    progress,
    chapterPositions = getActiveOdysseyChapterPositions(),
) {
    if (!Number.isFinite(progress)) return 1;
    const ch5Start = chapterPositions?.[4];
    const ch6Start = chapterPositions?.[5];
    if (!Number.isFinite(ch6Start)) return 1;
    if (progress <= ch6Start) return 1;

    // Recede over the SPACE span (ch6→ch7). Fall back to the Ch5 span as a proxy when the
    // next boundary is unknown (pilot/standalone).
    const ch7Start = chapterPositions?.[6];
    const spaceSpan = Number.isFinite(ch7Start) && ch7Start > ch6Start
        ? ch7Start - ch6Start
        : Math.max(1e-5, ch6Start - (Number.isFinite(ch5Start) ? ch5Start : ch6Start - 0.1));

    const holdEnd = ch6Start + spaceSpan * SKY_AURORA_EXIT_HOLD_BAND;
    if (progress <= holdEnd) return 1;
    const exitEnd = ch6Start + spaceSpan * SKY_AURORA_EXIT_TAIL_BAND;
    return 1 - smoothstep01((progress - holdEnd) / Math.max(1e-5, exitEnd - holdEnd));
}

function resolveSummitRingCameraFade(summitRing, camera) {
    if (!summitRing || !camera?.getWorldPosition || !camera?.getWorldDirection) return 1;

    const focus = summitRing.getObjectByName('ch4-center-hero') || summitRing;
    focus.getWorldPosition(summitRingTarget);
    camera.getWorldPosition(summitRingCameraPosition);
    camera.getWorldDirection(summitRingForward);

    summitRingForward.y = 0;
    summitRingToTarget.subVectors(summitRingTarget, summitRingCameraPosition);
    summitRingToTarget.y = 0;

    if (summitRingForward.lengthSq() < 1e-5 || summitRingToTarget.lengthSq() < 1e-5) {
        return 1;
    }

    summitRingForward.normalize();
    summitRingToTarget.normalize();
    const facing = summitRingForward.dot(summitRingToTarget);
    return THREE.MathUtils.smoothstep(
        facing,
        SUMMIT_RING_BEHIND_FADE_END_DOT,
        SUMMIT_RING_BEHIND_FADE_START_DOT,
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Environment Creation
// ═══════════════════════════════════════════════════════════════════════════════

function createSkyGradient(uniforms) {
    const { mesh, uniforms: gradientUniforms } = createSkyGradientTSL({
        uDusk: uniforms?.uDusk,
    });
    // Surface the baked dome sun direction so B7 can drive it from the camera aim
    // (a ch5 CHAPTER_LOOK is deferred); the sun is the single on-camera hero here.
    if (uniforms) {
        uniforms.uSunDir = gradientUniforms.uSunDir;
        // SEAM 5→6 (in-game "space too bright" fix): expose the bright-daylight dome's alpha so
        // update() can fade the BACKDROP out past the Space boundary. The manager crossfade can't
        // reach a NodeMaterial opacityNode, so this uOpacity was stuck at 1.0 and the 5→6 carry
        // dragged the opaque azure dome into the vacuum, washing Space white.
        uniforms.uSkyOpacity = gradientUniforms.uOpacity;
    }
    return mesh;
}

/**
 * On-camera warm sun-glow sprite stack (the repurposed eclipse warm glow), placed
 * coincident with the baked dome sun along the shared sun direction so the warm bloom
 * sits where the Mie sun is brightest. Returns the group so the caller can hold it.
 */
function createSunGlow(uniforms) {
    const group = new THREE.Group();
    group.name = 'sky-drift-sun';
    const { mesh } = createSunGlowTSL(uniforms.uTime);
    group.add(mesh);
    // Offset the glow group along the sun direction at a fixed mid-distance so it sits
    // on the baked sun. (B7 can re-aim by rotating this group with the camera look.)
    group.position.copy(SKY_DRIFT_SUN_DIR.clone().multiplyScalar(360));
    return group;
}

/**
 * God-ray FANS anchored at the on-camera sun. The TSL builder returns a group of 3
 * shaft fans; offset toward the sun azimuth so they rake down through the cloud gaps.
 */
function createCloudBreakShaft(uniforms) {
    const { group } = createCloudBreakShaftTSL(uniforms.uTime, { uDusk: uniforms.uDusk });
    return group;
}

function createCloudDecks() {
    const group = new THREE.Group();
    group.name = 'cloud-deck-break';
    // Kept as a compatibility hook for tests/scene contracts. The old canvas Sprite deck
    // could expose large rectangular quads on WebGPU; cloud structure now lives in the
    // TSL cloud-strata, lenticular landmark, wisps, and noctilucent veil layers.
    group.userData.replacedBy = 'cloud-strata-tsl';

    return group;
}

/**
 * Volumetric cloud strata — 6 feathered FBM sheets threaded through the camera
 * travel volume so the path dollies THROUGH layered cloud. This is the hero fix for
 * the empty washed-pale field; the corridor field still owns the FAR haze banks.
 * (Trimmed 10 → 6 for overdraw; fewer-bigger-richer sheets read the same.)
 */
function createCloudStrata(uniforms) {
    const { group } = createCloudStrataTSL(uniforms.uTime, {
        uDusk: uniforms.uDusk,
        uChapterFade: uniforms.uChapterFade,
    });
    return group;
}

/**
 * The bold, ever-present cool aurora HERO curtains across the upper frame (teal/green/
 * violet/magenta interplay, complementary to the warm sun). The TSL builder spreads
 * wide arcing curtains across the FULL travel depth so the aurora greets the camera at
 * chapter ENTRY and stays present through the whole chapter; the curtain shimmer is
 * driven by uniforms.uTime (ticked in the update loop). The update loop adds a slow
 * lateral sway + a gentle energy-driven brightening so the curtains feel alive.
 */
function createAuroraRibbons(uniforms) {
    const { group } = createAuroraRibbonsTSL(uniforms.uTime, { uDusk: uniforms.uDusk });
    // SEAM 5->6: surface the shared aurora fade uniform so the chapter update can recede the
    // whole curtain gracefully across the Sky→Space hand-off (the manager group-opacity
    // crossfade can't reach this NodeMaterial; its alpha flows through opacityNode/uOpacity).
    if (uniforms) {
        uniforms.uAuroraOpacity = group.userData.auroraOpacityUniform;
    }
    return group;
}

/**
 * Near-foreground cloud WISPS — repurposed from the old rain veil into fast streaking
 * near-cloud wisps that fly past the camera for a sense of speed/altitude and fill the
 * dead mid/right frame regions (the plan's "near-foreground wisps"). Built by the TSL
 * wisp builder (warm-light, additive-soft, radial-feathered, capped). The per-instance
 * world centers live in the `aBase` instanced attribute, which the update loop streaks
 * toward the camera. Mesh name kept as `rain-veil-particles` for the chapter contract.
 */
function createRainVeils(count, uniforms) {
    const { mesh } = createSkyWispTSL(uniforms.uTime, count);
    mesh.name = 'rain-veil-particles';
    return mesh;
}

export function createSkyDriftEnvironment(options = {}) {
    const group = new THREE.Group();
    group.name = 'sky-drift-environment';
    group.userData.chapterId = 5;
    group.userData.yStart = SKY_DRIFT_CONFIG.yStart;
    group.userData.yEnd = SKY_DRIFT_CONFIG.yEnd;
    const chapterRange = getChapterPathRange(5);
    const fallbackCenterY = (SKY_DRIFT_CONFIG.yStart + SKY_DRIFT_CONFIG.yEnd) / 2;
    const chapterCenterY = chapterRange?.center.y ?? fallbackCenterY;
    if (chapterRange) {
        group.userData.yStart = chapterRange.start.y;
        group.userData.yEnd = chapterRange.end.y;
    }

    // Shared TSL uniform nodes — passed INTO the .tsl.js builders so the update loop
    // keeps ticking `.value` exactly as before (uniform() exposes a `.value` setter).
    //
    // uDusk (creative plan ch5): ONE scalar (0 at the 4→5 seam → 1 at the 5→6 boundary)
    // scripts the whole chapter as a continuous dusk — sky bands, sun life, aurora
    // staging (faint 10% → hero 35% → corona 80%), strata moonlighting, fan death,
    // noctilucent reveal, and the JS-side light shifts all ride it.
    const uniforms = {
        uTime: uniform(0),
        uEnergy: uniform(0.4),
        uDusk: uniform(0),
        // Chapter crossfade the manager CANNOT reach (these builders use opacityNode, which ignores
        // material.opacity). Multiplied into the strata alpha; driven from chapterOpacity in update
        // so the bright cloud field fades in/out smoothly instead of popping when group.visible flips.
        uChapterFade: uniform(1),
    };
    group.userData.uniforms = uniforms;
    const chapterPositions = getActiveOdysseyChapterPositions();
    group.userData.chapterTStart = chapterPositions?.[4] ?? 0.5;
    group.userData.chapterTEnd = chapterPositions?.[5] ?? 0.67;

    // Sky background — the structured vertical gradient + the BOOSTED on-camera Mie
    // sun (the hero). createSkyGradient surfaces uniforms.uSunDir for B7.
    const skyGradient = createSkyGradient(uniforms);
    group.add(skyGradient);
    group.userData.skyGradient = skyGradient;

    const cloudDecks = createCloudDecks();
    group.add(cloudDecks);
    group.userData.cloudDecks = cloudDecks;

    // Volumetric cloud strata threaded through the camera travel volume — the path
    // now dollies BETWEEN 6 layered cloud sheets (kills the empty washed-pale field).
    const cloudStrata = createCloudStrata(uniforms);
    group.add(cloudStrata);
    group.userData.cloudStrata = cloudStrata;

    // God-ray FANS anchored at the on-camera sun (raking down through the cloud gaps).
    const lightShaft = createCloudBreakShaft(uniforms);
    group.add(lightShaft);
    group.userData.lightShaft = lightShaft;

    // The arching cool teal→violet aurora HERO curtain across the upper frame.
    const aurora = createAuroraRibbons(uniforms);
    group.add(aurora);
    group.userData.aurora = aurora;

    // On-camera warm SUN glow sprite (repurposed from the deleted eclipse warm glow),
    // coincident with the baked dome sun. The single on-camera hero/anchor/light.
    const sunGlow = createSunGlow(uniforms);
    group.add(sunGlow);
    group.userData.sunGlow = sunGlow;

    // NO stars / galaxy / eclipse / nebulae / planets — those read as dark "bruise"
    // blobs against the bright sky and broke the no-space identity. Chapter 5 is a
    // luminous daytime cloud cathedral: structure comes from the gradient, sun, cloud
    // strata, god-ray fans, aurora curtain and near-foreground wisps.

    // Near-foreground cloud wisps for speed/altitude (repurposed rain veil).
    const rainVeils = createRainVeils(options.particleCount || 280, uniforms);
    group.add(rainVeils);
    group.userData.rainVeils = rainVeils;

    // RECEDING SUMMIT RING (creative plan asset 1): the actual Chapter 4 mountain range,
    // rendered at the same world coordinates. It stays visible while still in the camera's
    // forward view, then fades only after the camera has actually passed it; no separate
    // replacement mountain assets, no silhouette swap.
    const ringOpacityUniforms = [];
    const { group: summitRing, parts: summitRingParts } = createCanonicalMountainRangeTSL({
        hostCenter: chapterRange?.center,
        hostChapterId: 5,
        name: 'receding-summit-ring',
        // L5 DEDUP continuity (Wave D): null → constant full alpenglow, matching Ch3's distant
        // preview and Ch4's main-peaks, so when the manager hands seam authority between the coplanar
        // copies the silhouette does not pop tone. (Was uniform(0.55) — a partial alpenglow that
        // differed from Ch4's full-lit copy at the 4→5 hand-off.)
        uTransition: null,
        // Flank chains (2026-08, was false): all three L5 hosts must agree or the far
        // silhouettes would vanish in one frame at the 4→5 authority flip.
        includeFarRange: true,
        opacityTargets: ringOpacityUniforms,
        baseOpacity: 1,
    });
    // Pin the ring to full winter snow like Ch4's main-peaks so the shared silhouette is
    // byte-identical across the 4→5 hand-off (the manager draws only one copy through the seam).
    summitRingParts.forEach((part) => {
        if (part.uniforms?.uSnowBlend) part.uniforms.uSnowBlend.value = 1;
    });
    summitRing.userData.baseY = summitRing.position.y;
    group.add(summitRing);
    group.userData.summitRing = summitRing;
    group.userData.summitRingOpacityUniforms = ringOpacityUniforms;

    // CLOUD-SEA DECK (2026-08, Wave C — landscape lever L1): the sharpest 4→5 geometry break was
    // that Ch4's cloud-sea deck (the silver sea its peaks rise from) is Ch4-only and FADES OUT at
    // the seam, so Ch5 had NO floor — you drifted in empty sky instead of ABOVE the sea. Give Ch5
    // the SAME deck, WORLD-LOCKED at the Ch4 deck's world-Y (≈312), so the sunlit cloud-sea persists
    // and recedes below as the camera climbs (516→655) — the Europa "above the clouds" read and a
    // literal ground handoff between the chapters.
    const ch4Range = getChapterPathRange(4);
    const cloudSeaWorldY = (ch4Range?.start?.y ?? 366) - 54; // matches mountain-peaks' cloud-sea deck
    const cloudSea = createCloudSeaDeckTSL({
        uTime: uniforms.uTime,
        uTransition: uniform(0), // stay bright — no night cooling
        y: cloudSeaWorldY - chapterCenterY, // local offset → world-locked at the shared sea altitude
    });
    group.add(cloudSea.mesh);
    group.userData.cloudSea = cloudSea.mesh;
    group.userData.cloudSeaReveal = cloudSea.uniforms.uReveal; // 5→6 space-backdrop fade
    group.userData.cloudSeaOpacityUniform = cloudSea.uniforms.uOpacity; // base 0.92; chapter crossfade

    // LENTICULAR LANDMARK (creative plan asset 5): the stationary lens-cloud stack
    // mid-right of the path around 45–55% — kills the dead stretch as a scale object.
    const lenticular = createLenticularCloudTSL(uniforms.uTime, { uDusk: uniforms.uDusk });
    lenticular.group.position.set(150, 36, -380);
    group.add(lenticular.group);
    group.userData.lenticular = lenticular.group;

    // NOCTILUCENT VEIL (creative plan asset 7): the electric-blue "last clouds" high
    // overhead, revealed only across the final ~15% of the dusk.
    const noctilucent = createNoctilucentVeilTSL(uniforms.uTime, { uDusk: uniforms.uDusk });
    noctilucent.mesh.position.set(0, 170, -420);
    noctilucent.mesh.rotation.x = -Math.PI / 2.3;
    group.add(noctilucent.mesh);
    group.userData.noctilucent = noctilucent.mesh;

    // ICE SPINDRIFT (creative plan asset 6): near-field sparkle. The DARK FOREGROUND WISPS (asset 8,
    // a near-black value anchor for the old lavender-dusk wash) are REMOVED — a night motif that
    // would speckle black against the bright daylight sky.
    const iceCrystals = createIceCrystalsTSL(uniforms.uTime, 120, { uDusk: uniforms.uDusk });
    group.add(iceCrystals.mesh);
    group.userData.iceCrystals = iceCrystals.mesh;

    setupSkyLighting(group);
    // Anchor the whole environment to the path's FULL centre (x/y/z), not just Y,
    // so the backdrop and cloud-break shaft stay centred on the path and the path
    // never clips through chapter geometry (matches mountain-peaks.js).
    if (chapterRange?.center) {
        group.position.set(chapterRange.center.x, chapterCenterY, chapterRange.center.z);
    } else {
        group.position.y = chapterCenterY;
    }

    return group;
}

function setupSkyLighting(group) {
    // PAINTERLY-ASCENT REPALETTE (2026-08, Wave C): bright cool-white DAYLIGHT ambient (was dark
    // indigo 0x1a1a2e@0.3, which lit the sky chapter like night); the cosmic purple/cyan glows are
    // dimmed so they no longer tint the sunlit clouds, and the warm sun key is strengthened.
    group.add(new THREE.AmbientLight(0x9fc4e8, 0.6));

    const purpleGlow = new THREE.PointLight(0x9933FF, 0.12, 400);
    purpleGlow.position.set(-50, 40, -600);
    group.add(purpleGlow);
    group.userData.purpleGlow = purpleGlow;

    const cyanGlow = new THREE.PointLight(0x3399FF, 0.10, 400);
    cyanGlow.position.set(60, 20, -600);
    group.add(cyanGlow);
    group.userData.cyanGlow = cyanGlow;

    // Warm sun key — placed toward the on-camera sun azimuth so the clouds catch a
    // warm sun-side rim (matches the baked Mie sun / sun-glow sprite).
    const sunKey = new THREE.PointLight(0xffe4b8, 0.6, 600);
    sunKey.position.copy(SKY_DRIFT_SUN_DIR.clone().multiplyScalar(360));
    group.add(sunKey);
    group.userData.sunKey = sunKey;

    // duskProgress shifts the glows toward AURORA GREEN as the curtains take over the
    // saturation budget (creative plan item 8). Colors precomputed — no per-frame
    // allocation; the update loop rewrites color/intensity every frame (QW4 rule).
    group.userData.duskLightColors = {
        purpleBase: new THREE.Color(0x9933ff),
        cyanBase: new THREE.Color(0x3399ff),
        auroraGreen: new THREE.Color(0x3dff8e),
        auroraTeal: new THREE.Color(0x2fe8b0),
    };
}

export function updateSkyDriftEnvironment(group, delta, time, ...updateArgs) {
    const [camera = null, cameraProgress = null, directorState = null] = updateArgs;
    const { uniforms } = group.userData;
    if (uniforms?.uTime) {
        uniforms.uTime.value = time;
    }

    // duskProgress (creative plan ch5): chapter-local progress 0→1 scripts the whole
    // continuous dusk. Everything below — the dome bands, sun life, aurora staging,
    // strata moonlighting, summit-ring recede, and the light shifts — rides this.
    let dusk = uniforms?.uDusk ? uniforms.uDusk.value : 0;
    if (uniforms?.uDusk && Number.isFinite(cameraProgress)) {
        const tStart = group.userData.chapterTStart ?? 0.5;
        const tEnd = group.userData.chapterTEnd ?? 0.67;
        const span = Math.max(tEnd - tStart, 1e-4);
        // PAINTERLY-ASCENT REPALETTE (2026-08, Wave C): CAP dusk low so the chapter stays bright
        // daylight. This is the master switch — it un-stages the aurora + noctilucent veil (both
        // uDusk-gated), stops the strata moonlighting and the sun-death, and keeps the glows from
        // shifting aurora-green. The whole dusk→night script is neutralized at the source; Ch5 is
        // now the sunlit cloud-sea payoff, not a night sky.
        dusk = Math.min(THREE.MathUtils.clamp((cameraProgress - tStart) / span, 0, 1), 0.1);
        uniforms.uDusk.value = dusk;
    }

    // The low sun SINKS toward the horizon as the dusk deepens (the dome's sun terms
    // die by ~55%; the elevation slide makes the descent read while it lives).
    if (uniforms?.uSunDir?.value) {
        const elevation = 0.3 - 0.26 * THREE.MathUtils.smoothstep(dusk, 0.05, 0.5);
        uniforms.uSunDir.value.set(0.34, elevation, -0.88).normalize();
    }

    // SEAM 5->6: the ChapterEnvironmentManager fades the whole Ch5 env opacity (group
    // userData.chapterOpacity) on a long HELD ease as the camera crosses into Space, but it
    // cannot reach these NodeMaterials (alpha flows through opacityNode/uOpacity). Multiply
    // it in here so the summit ring + aurora DISSOLVE smoothly with the rest of the chapter
    // instead of popping when group.visible finally flips. Defaults to 1 (pilot/playground,
    // no manager) so standalone use is unchanged.
    const chapterOpacity = THREE.MathUtils.clamp(group.userData.chapterOpacity ?? 1, 0, 1);
    // Fade the bright cloud strata IN with the chapter weight (4→5 entry) so they don't POP in when
    // the manager flips group.visible (the manager can't reach their opacityNode).
    if (uniforms?.uChapterFade) uniforms.uChapterFade.value = chapterOpacity;

    // ── SEAM 5→6: DARK-SPACE BACKDROP HANDOFF (in-game "space too bright" regression fix) ──────
    // The 5→6 carry keeps the whole Ch5 group present ~85% into Space so the aurora + summit ring
    // can linger; Wave-C made Ch5's sky-dome bright DAYLIGHT, so the carry now drags that opaque
    // dome (+ cloud-sea + strata) into the vacuum and washes Space WHITE — additive cosmic glows
    // vanish and dark bodies read as "black circles". Fade the BACKDROP here, DECOUPLED from the
    // carry: 1 through Ch5, easing to 0 across the first ~12% of Space past the boundary. The aurora
    // + summit ring are EXCLUDED (they keep the long carry and now read on the dark vacuum).
    const skyChapterPositions = getActiveOdysseyChapterPositions();
    const ch6StartP = skyChapterPositions?.[5];
    const ch7StartP = skyChapterPositions?.[6];
    let spaceBackdropFade = 1;
    if (Number.isFinite(ch6StartP) && Number.isFinite(cameraProgress) && cameraProgress > ch6StartP) {
        const spaceSpan = (Number.isFinite(ch7StartP) && ch7StartP > ch6StartP)
            ? ch7StartP - ch6StartP : 0.15;
        spaceBackdropFade = 1 - smoothstep01(
            (cameraProgress - ch6StartP) / Math.max(1e-5, spaceSpan * 0.12),
        );
    }
    if (uniforms?.uSkyOpacity) uniforms.uSkyOpacity.value = spaceBackdropFade * chapterOpacity;
    if (group.userData.cloudSeaReveal) group.userData.cloudSeaReveal.value = spaceBackdropFade;
    // Cloud strata + additive daytime backdrop have no reachable opacity uniform; gate them off once
    // the dome fade has effectively completed so no bright residual lingers in the vacuum.
    const backdropVisible = spaceBackdropFade > 0.02;
    [group.userData.skyGradient, group.userData.cloudStrata, group.userData.sunGlow,
        group.userData.lightShaft, group.userData.lenticular, group.userData.noctilucent,
        group.userData.iceCrystals, group.userData.rainVeils, group.userData.cloudDecks]
        .forEach((o) => { if (o) o.visible = backdropVisible; });

    // RECEDING SUMMIT RING: the same Ch4 hero chain remains visible until the camera has
    // actually passed it. Dusk may change the sky, but it does NOT delete the mountain
    // while the peak is still in front of the camera.
    const { summitRing } = group.userData;
    if (summitRing) {
        summitRing.position.y = summitRing.userData.baseY ?? 0;
        const ringFade = resolveSummitRingCameraFade(summitRing, camera);
        (group.userData.summitRingOpacityUniforms || []).forEach((target) => {
            if (target.__odysseyBaseOpacity === undefined) {
                target.__odysseyBaseOpacity = target.value;
            }
            // 4→5 L5-DEDUP HANDOFF: gate by the 5→6 EXIT opacity, NOT the raw chapterOpacity.
            // chapterOpacity also ramps 0→1 across the 4→5 ENTRY, so at the L5 authority flip the
            // shared summit swapped from ungated mainPeaks@1.0 to summitRing@~0.5 = a dip-then-pop.
            // exit-opacity is 1.0 through the whole 4→5 handoff and only eases at the 5→6 tail.
            target.value = target.__odysseyBaseOpacity * ringFade
                * resolveSkyDriftAuroraExitOpacity(cameraProgress);
        });
    }

    // SEAM 5->6: recede the aurora curtain (1->0) across Space so it lingers then dissolves
    // as the camera moves on (the curtain is world-locked deep ahead and never passed). The
    // staged dusk ramp inside the ribbon material owns the in-chapter intensity; this is the
    // boundary hand-off, held then eased and gated by chapterOpacity so it never pops.
    if (uniforms?.uAuroraOpacity) {
        uniforms.uAuroraOpacity.value = resolveSkyDriftAuroraExitOpacity(cameraProgress) * chapterOpacity;
    }
    // Autonomous energy breath (Phase 6 will drive this from the audio reactor).
    if (uniforms?.uEnergy) {
        const audioEnergy = directorState
            ? THREE.MathUtils.clamp((directorState.energy || 0) * 0.75 + (directorState.treble || 0) * 0.25, 0, 1)
            : null;
        uniforms.uEnergy.value = audioEnergy === null
            ? 0.4 + Math.sin(time * 0.55) * 0.2
            : 0.28 + audioEnergy * 0.62 + (directorState.beatPulse || 0) * 0.08;
    }

    // Pulse lighting — and shift the glows toward AURORA GREEN as the dusk deepens
    // (creative plan item 8): the curtains own the saturation budget from Act II on.
    const duskLightT = THREE.MathUtils.smoothstep(dusk, 0.3, 0.7);
    const { purpleGlow, cyanGlow, duskLightColors } = group.userData;
    if (purpleGlow) {
        purpleGlow.intensity = 0.4 + Math.sin(time * 0.3) * 0.15 + (uniforms?.uEnergy?.value ?? 0) * 0.2;
        if (duskLightColors) {
            purpleGlow.color.copy(duskLightColors.purpleBase)
                .lerp(duskLightColors.auroraGreen, duskLightT * 0.8);
        }
    }
    if (cyanGlow && duskLightColors) {
        cyanGlow.color.copy(duskLightColors.cyanBase)
            .lerp(duskLightColors.auroraTeal, duskLightT * 0.8);
        cyanGlow.intensity = 0.3;
    }

    const { cloudDecks } = group.userData;
    if (cloudDecks) {
        cloudDecks.rotation.y += delta * 0.006;
        cloudDecks.rotation.z = Math.sin(time * 0.07) * 0.015;
    }

    // Cloud strata breathe/drift gently (the FBM already animates internally via
    // uTime; this adds a slow lateral sway so the layers feel alive as parallax).
    const { cloudStrata } = group.userData;
    if (cloudStrata) {
        cloudStrata.children.forEach((sheet, i) => {
            sheet.position.x += Math.sin(time * 0.05 + i * 1.3) * delta * 0.6;
        });
    }

    // Aurora HERO curtains: the per-strand shimmer is GPU-driven by uTime, so here we
    // only add a slow whole-curtain sway (a gentle world-up bob + lateral drift) so the
    // ever-present curtains breathe rather than sit static. No per-frame allocation —
    // we write the group transform directly. The curtains are anchored well above the
    // path so this never clips the dolly.
    const { aurora } = group.userData;
    if (aurora) {
        aurora.position.x = Math.sin(time * 0.04) * 8;
        aurora.position.y = Math.sin(time * 0.06) * 4;
        aurora.rotation.z = Math.sin(time * 0.03) * 0.02;
    }

    // Pulse the warm sun key gently with the energy breath so the sun feels alive —
    // and let it DIE with the sun across the mid-dusk (the aurora inherits the frame).
    const { sunKey } = group.userData;
    if (sunKey) {
        const sunAlive = 1 - THREE.MathUtils.smoothstep(dusk, 0.32, 0.55);
        sunKey.intensity = (0.42 + Math.sin(time * 0.4) * 0.06
            + (uniforms?.uEnergy?.value ?? 0) * 0.12) * sunAlive;
    }

    // Near-foreground wisps STREAK forward past the camera (toward +Z) for a sense of
    // speed/altitude, recycling to the far edge — replaces the old falling rain.
    //
    // PERF (Batch5): the per-frame CPU loop that rewrote the wisps' `aBase` array (and
    // re-uploaded it via `needsUpdate=true`) is GONE. The streak + recycle now runs on
    // the GPU inside createSkyWispTSL's positionNode, driven by uniforms.uTime ticked
    // above plus the static per-instance aSpeed/aSeed attributes. Nothing to do here.
}

export default {
    config: SKY_DRIFT_CONFIG,
    create: createSkyDriftEnvironment,
    update: updateSkyDriftEnvironment,
};
