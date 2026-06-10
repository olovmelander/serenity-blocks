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
    SKY_DRIFT_SUN_DIR,
} from './sky-drift.tsl.js';

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
const SKY_AURORA_EXIT_BAND = 0.34; // fraction of Ch5 span before the boundary over which to recede

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
    const { mesh, uniforms: gradientUniforms } = createSkyGradientTSL();
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
    const { group } = createCloudBreakShaftTSL(uniforms.uTime);
    return group;
}

function createCloudDecks() {
    const group = new THREE.Group();
    group.name = 'cloud-deck-break';
    const glowTexture = createGlowTexture();
    // Cooler, less saturated cloud tints (was 0xffe6cc warm) so the additive deck
    // contributes atmospheric depth without pushing the lower frame toward white.
    const cloudColors = [0xb9d6f5, 0xe6d2c4, 0xa9bdf0];

    for (let layer = 0; layer < 3; layer += 1) {
        const radius = 95 + layer * 38;
        const count = 24 + layer * 8;
        for (let index = 0; index < count; index += 1) {
            const angle = (index / count) * Math.PI * 2 + layer * 0.33;
            const gap = Math.abs(Math.sin(angle * 0.5));
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
                map: glowTexture,
                color: cloudColors[(index + layer) % cloudColors.length],
                transparent: true,
                // Reduced base/per-layer opacity (was 0.18 + layer*0.05).
                opacity: (0.12 + layer * 0.035) * (0.55 + gap * 0.45),
                blending: THREE.AdditiveBlending,
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
    const { group } = createCloudStrataTSL(uniforms.uTime);
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
    const { group } = createAuroraRibbonsTSL(uniforms.uTime);
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
    const uniforms = {
        uTime: uniform(0),
        uEnergy: uniform(0.4),
    };
    group.userData.uniforms = uniforms;

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

function createGlowTexture() {
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
    return new THREE.CanvasTexture(canvas);
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

    // Warm sun key — placed toward the on-camera sun azimuth so the clouds catch a
    // warm sun-side rim (matches the baked Mie sun / sun-glow sprite).
    const sunKey = new THREE.PointLight(0xffcf88, 0.42, 600);
    sunKey.position.copy(SKY_DRIFT_SUN_DIR.clone().multiplyScalar(360));
    group.add(sunKey);
    group.userData.sunKey = sunKey;
}

export function updateSkyDriftEnvironment(group, delta, time, ...updateArgs) {
    const [, cameraProgress = null, directorState = null] = updateArgs;
    const { uniforms } = group.userData;
    if (uniforms?.uTime) {
        uniforms.uTime.value = time;
    }

    // SEAM 5->6: recede the ever-present aurora curtain (1->0) across the back of Ch5 so it
    // fades out gracefully into Space rather than popping when the group hides.
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

    // Pulse lighting
    const { purpleGlow } = group.userData;
    if (purpleGlow) {
        purpleGlow.intensity = 0.4 + Math.sin(time * 0.3) * 0.15 + (uniforms?.uEnergy?.value ?? 0) * 0.2;
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

    // Pulse the warm sun key gently with the energy breath so the sun feels alive.
    const { sunKey } = group.userData;
    if (sunKey) {
        sunKey.intensity = 0.42 + Math.sin(time * 0.4) * 0.06 + (uniforms?.uEnergy?.value ?? 0) * 0.12;
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
