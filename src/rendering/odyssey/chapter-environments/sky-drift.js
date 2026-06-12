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
    createDarkWispsTSL,
    SKY_DRIFT_SUN_DIR,
} from './sky-drift.tsl.js';
import { createFBMMountainTSL } from './mountain-peaks.tsl.js';
import { MOUNTAIN_SHADING, resolveMountainTreatment } from './shared/mountain-language.js';

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
const SKY_AURORA_EXIT_BAND = 0.15; // fraction of Ch5 span before the boundary over which to recede

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
    const ch6Start = chapterPositions?.[5] ?? 1;
    if (!Number.isFinite(ch5Start) || ch6Start <= ch5Start) return 1;

    const span = ch6Start - ch5Start;
    const exitStart = ch6Start - span * SKY_AURORA_EXIT_BAND;
    // 1->0 as progress rises from exitStart to the boundary (reversed smoothstep edges).
    return smoothstep01((ch6Start - progress) / Math.max(1e-5, ch6Start - exitStart));
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
    const glowTexture = createGlowTexture();
    // MOONLIT STRATOCUMULUS (creative plan asset 4): silver-blue tops over INK cores.
    // Every third sprite is an ink-core shred on NORMAL blending — the additive-only
    // deck could only ever brighten the frame; the ink sprites are the Act II horizon's
    // dark value anchor.
    const cloudColors = [0x8fa3c8, 0x1a2238, 0xa9bdf0];

    for (let layer = 0; layer < 3; layer += 1) {
        const radius = 95 + layer * 38;
        const count = 24 + layer * 8;
        for (let index = 0; index < count; index += 1) {
            const angle = (index / count) * Math.PI * 2 + layer * 0.33;
            const gap = Math.abs(Math.sin(angle * 0.5));
            const colorHex = cloudColors[(index + layer) % cloudColors.length];
            const isInkCore = colorHex === 0x1a2238;
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
                map: glowTexture,
                color: colorHex,
                transparent: true,
                opacity: isInkCore
                    ? 0.3 * (0.55 + gap * 0.45)
                    : (0.12 + layer * 0.035) * (0.55 + gap * 0.45),
                blending: isInkCore ? THREE.NormalBlending : THREE.AdditiveBlending,
                depthWrite: false,
            }));
            sprite.position.set(
                Math.cos(angle) * radius,
                -30 + Math.sin(angle * 1.7) * 18 + layer * 8,
                -500 - layer * 70 + Math.sin(angle) * 28,
            );
            const scale = 42 + Math.random() * 34 + layer * 10;
            sprite.scale.set(scale * 1.8, scale, 1);
            group.add(sprite);
        }
    }

    return group;
}

/**
 * Volumetric cloud strata — 6 feathered FBM sheets threaded through the camera
 * travel volume so the path dollies THROUGH layered cloud. This is the hero fix for
 * the empty washed-pale field; the corridor field still owns the FAR haze banks.
 * (Trimmed 10 → 6 for overdraw; fewer-bigger-richer sheets read the same.)
 */
function createCloudStrata(uniforms) {
    const { group } = createCloudStrataTSL(uniforms.uTime, { uDusk: uniforms.uDusk });
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
    };
    group.userData.uniforms = uniforms;
    const chapterPositions = getActiveOdysseyChapterPositions();
    group.userData.chapterTStart = chapterPositions?.[4] ?? 0.5;
    group.userData.chapterTEnd = chapterPositions?.[5] ?? 0.67;

    // Sky background — the structured vertical gradient + the BOOSTED on-camera Mie
    // sun (the hero). createSkyGradient surfaces uniforms.uSunDir for B7.
    group.add(createSkyGradient(uniforms));

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
    const rainVeils = createRainVeils(options.particleCount || 380, uniforms);
    group.add(rainVeils);
    group.userData.rainVeils = rainVeils;

    // RECEDING SUMMIT RING (creative plan asset 1): the world we left. Two ridge
    // silhouettes from the shared mountain language sit below/behind the path at the
    // chapter entry — Chapter 4's peaks still visible as anchors — then sink and fade
    // across the first ~30% of the dusk (the chapter-authored entry handoff; no pop).
    const summitRing = new THREE.Group();
    summitRing.name = 'receding-summit-ring';
    const ringTreatment = resolveMountainTreatment({
        coolTemp: 0.9,
        snowLine: MOUNTAIN_SHADING.snowLine,
    });
    const ringOpacityUniforms = [];
    [
        {
            size: 860, height: 300, position: new THREE.Vector3(-160, -150, -180), seed: 12.34,
        },
        {
            size: 760, height: 250, position: new THREE.Vector3(180, -170, -330), seed: 45.67,
        },
    ].forEach((config) => {
        const ridge = createFBMMountainTSL({
            ...config,
            treatment: ringTreatment,
            base: { baseMistStrength: 0.35, baseFadeStart: 0.04, baseFadeEnd: 0.16 },
            transition: uniform(0.55),
        });
        if (ridge.uniforms?.uOpacity) ringOpacityUniforms.push(ridge.uniforms.uOpacity);
        summitRing.add(ridge.mesh);
    });
    summitRing.userData.baseY = summitRing.position.y;
    group.add(summitRing);
    group.userData.summitRing = summitRing;
    group.userData.summitRingOpacityUniforms = ringOpacityUniforms;

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

    // ICE SPINDRIFT (creative plan asset 6) + DARK FOREGROUND WISPS (asset 8): the
    // near-field sparkle and the near-black value anchor the lavender wash never had.
    const iceCrystals = createIceCrystalsTSL(uniforms.uTime, 160, { uDusk: uniforms.uDusk });
    group.add(iceCrystals.mesh);
    group.userData.iceCrystals = iceCrystals.mesh;
    const darkWisps = createDarkWispsTSL(uniforms.uTime, 10);
    group.add(darkWisps.mesh);
    group.userData.darkWisps = darkWisps.mesh;

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

// Canvas raster memoized at module scope (startup micro-win); the CanvasTexture is
// fresh per call so per-environment disposal can never poison a later session.
let _glowCanvas = null;
function createGlowTexture() {
    if (!_glowCanvas) {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
        gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.8)');
        gradient.addColorStop(0.4, 'rgba(255, 255, 255, 0.4)');
        gradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.1)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 128, 128);
        _glowCanvas = canvas;
    }
    return new THREE.CanvasTexture(_glowCanvas);
}

function setupSkyLighting(group) {
    group.add(new THREE.AmbientLight(0x1a1a2e, 0.3));

    const purpleGlow = new THREE.PointLight(0x9933FF, 0.4, 400); // Increased range
    purpleGlow.position.set(-50, 40, -600);
    group.add(purpleGlow);
    group.userData.purpleGlow = purpleGlow;

    const cyanGlow = new THREE.PointLight(0x3399FF, 0.3, 400);
    cyanGlow.position.set(60, 20, -600);
    group.add(cyanGlow);
    group.userData.cyanGlow = cyanGlow;

    // Warm sun key — placed toward the on-camera sun azimuth so the clouds catch a
    // warm sun-side rim (matches the baked Mie sun / sun-glow sprite).
    const sunKey = new THREE.PointLight(0xffcf88, 0.42, 600);
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
    const [, cameraProgress = null, directorState = null] = updateArgs;
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
        dusk = THREE.MathUtils.clamp((cameraProgress - tStart) / span, 0, 1);
        uniforms.uDusk.value = dusk;
    }

    // The low sun SINKS toward the horizon as the dusk deepens (the dome's sun terms
    // die by ~55%; the elevation slide makes the descent read while it lives).
    if (uniforms?.uSunDir?.value) {
        const elevation = 0.3 - 0.26 * THREE.MathUtils.smoothstep(dusk, 0.05, 0.5);
        uniforms.uSunDir.value.set(0.34, elevation, -0.88).normalize();
    }

    // RECEDING SUMMIT RING: the Ch4 peaks sink below frame and fog-swallow across the
    // first ~30% of the dusk — eight beats, not one (the 01–04 silhouettes fix).
    const { summitRing } = group.userData;
    if (summitRing) {
        const recede = THREE.MathUtils.smoothstep(dusk, 0.05, 0.32);
        summitRing.position.y = (summitRing.userData.baseY ?? 0) - recede * 70;
        const ringFade = 1 - recede;
        (group.userData.summitRingOpacityUniforms || []).forEach((target) => {
            if (target.__odysseyBaseOpacity === undefined) {
                target.__odysseyBaseOpacity = target.value;
            }
            target.value = target.__odysseyBaseOpacity * ringFade;
        });
    }

    // SEAM 5->6: recede the aurora curtain (1->0) across the back of Ch5 so it fades
    // gracefully into Space rather than popping when the group hides. (The staged dusk
    // ramp inside the ribbon material owns the in-chapter intensity; this is only the
    // boundary hand-off, narrowed to the final 15%.)
    if (uniforms?.uAuroraOpacity) {
        uniforms.uAuroraOpacity.value = resolveSkyDriftAuroraExitOpacity(cameraProgress);
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
