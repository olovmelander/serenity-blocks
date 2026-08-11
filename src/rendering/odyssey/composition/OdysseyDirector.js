/**
 * @fileoverview OdysseyDirector — the conductor of the cosmic ascent
 *
 * Part of the Odyssey AAA "Cosmic Ascent" overhaul (Phase 0 — spine scaffolding).
 * See docs/ODYSSEY_MODE_AAA_OVERHAUL_PLAN.md §4.2.
 *
 * One class, updated once per frame from OdysseyBoardController.renderFrame(),
 * owning the journey's continuous state and exposing it for every subsystem to
 * read. Inputs: ascentProgress (camera position), the chapter blend state, the
 * audio reactor signal, and discrete game/navigation events. Outputs (all
 * smoothed, allocation-free): blended atmosphere params, key-light, exposure,
 * derived post emphasis, path/node emphasis, and a blended camera profile.
 *
 * PHASE 0 CONTRACT: the director only *computes and exposes* state. No subsystem
 * consumes getState() yet (except the debug overlay), so wiring it in is a strict
 * no-op visually. Phases 1–7 progressively read this state.
 */

import * as THREE from 'three/webgpu';
import { CHAPTER_CONFIGS } from '../../../core/odyssey/data/chapters.js';
import { resolveChapterBlendState } from '../ChapterEnvironmentManager.js';
import {
    getChapterProfile,
    getCameraProfileForChapter,
    lerpNumber,
} from '../chapter-environments/shared/chapter-profile.js';
// E3 — one source of truth for the 3->4/5->6 colour bridges (was copy-pasted here + in CEM).
import {
    SEAM_34_ALPINE_BRIDGE,
    SEAM_45_SKY_BRIDGE,
    SEAM_56_AURORA_BRIDGE,
    SEAM_34_COLOUR_HALF_WIDTH as SEAM_34_ALPINE_COLOUR_HALF_WIDTH,
    SEAM_45_COLOUR_HALF_WIDTH as SEAM_45_SKY_COLOUR_HALF_WIDTH,
    SEAM_56_COLOUR_HALF_WIDTH as SEAM_56_AURORA_COLOUR_HALF_WIDTH,
} from '../chapter-environments/shared/seam-bridges.js';

const ENERGY_ATTACK_RATE = 9.0; // toward a higher audio energy (fast)
const ENERGY_RELEASE_RATE = 2.5; // back down (slow, so it "breathes")
const PULSE_DECAY_RATE = 6.0; // beat-pulse envelope decay

function expApproach(current, target, rate, dt) {
    if (!(dt > 0) || !(rate > 0)) return current;
    const t = 1 - Math.exp(-rate * dt);
    return current + (target - current) * t;
}

function smootherstep01(value) {
    const t = THREE.MathUtils.clamp(value, 0, 1);
    return t * t * t * (t * (t * 6 - 15) + 10);
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
        return lerpNumber(start, bridge, smootherstep01(clamped * 2));
    }
    return lerpNumber(bridge, end, smootherstep01((clamped - 0.5) * 2));
}

export class OdysseyDirector {
    /**
     * @param {object} [options]
     * @param {number[]} [options.chapterPositions] - normalized chapter boundary positions
     */
    constructor(options = {}) {
        this.chapterPositions = Array.isArray(options.chapterPositions) && options.chapterPositions.length >= 2
            ? [...options.chapterPositions]
            : null;

        this.time = 0;
        this.energy = 0; // smoothed master energy
        this.beatPulse = 0; // beat-triggered envelope [0..1]
        this._lastBlendState = null;
        this._lastBoundaryId = null;

        // Discrete event memory (for Phase 5 threshold director / Phase 7 vista beats).
        this.events = {
            lastBoundaryCross: null, // { boundaryId, atMs, direction }
            lastNodeFocus: null, // { levelId, atMs }
            lastLevelSelect: null, // { levelId, atMs }
            lastChapterEnter: null, // { chapterId, fromChapter, atMs }
        };

        // Reusable scratch + output (never reallocated per frame).
        this._scratchA = new THREE.Color();
        this._scratchB = new THREE.Color();

        this.state = {
            ascentProgress: 0,
            // audio
            energy: 0,
            bass: 0,
            mid: 0,
            treble: 0,
            beat: false,
            beatPulse: 0,
            audioAvailable: false,
            // journey
            activeChapter: 1,
            sourceChapter: 1,
            targetChapter: 1,
            seamProgress: 0,
            rawSeamProgress: 0,
            seamPhase: 0,
            seamEnvelope: 0,
            inSeam: false,
            boundaryId: null,
            boundaryPosition: null,
            seamWidth: null,
            act: getChapterProfile(1).act,
            // blended atmosphere (colors are live THREE.Color refs — read, don't mutate)
            atmosphere: {
                skyColor: new THREE.Color(),
                fogColor: new THREE.Color(),
                ambientColor: new THREE.Color(),
                lightColor: new THREE.Color(),
                lightDir: new THREE.Vector3(),
                fogDensity: 0,
                ambientIntensity: 0,
                lightIntensity: 0,
                exposure: 1,
            },
            // blended camera framing target (Phase 7 consumes)
            camera: {
                followDistance: 18, fovBase: 60, sway: 1, bob: 1, drift: 1,
            },
            // derived emphasis scalars (Phase 1/3/6 consume)
            post: {
                bloom: 1, grade: 0, dof: 0, godRay: 0,
            },
            path: { headGlow: 0.6, flowSpeed: 0.8, beatPulse: 0 },
            node: { focalPulse: 0 },
        };
    }

    setChapterPositions(chapterPositions = []) {
        if (Array.isArray(chapterPositions) && chapterPositions.length >= 2) {
            this.chapterPositions = chapterPositions.filter((p) => Number.isFinite(p));
        }
    }

    // ── Discrete events (recorded now, consumed in later phases) ───────────────

    onBoundaryCross(boundaryId, direction = 1) {
        this.events.lastBoundaryCross = { boundaryId, direction, atMs: this.time * 1000 };
    }

    onNodeFocus(levelId) {
        this.events.lastNodeFocus = { levelId, atMs: this.time * 1000 };
    }

    onLevelSelect(levelId) {
        this.events.lastLevelSelect = { levelId, atMs: this.time * 1000 };
    }

    onChapterEnter(chapterId, fromChapter = null) {
        this.events.lastChapterEnter = { chapterId, fromChapter, atMs: this.time * 1000 };
    }

    // ── Per-frame update ───────────────────────────────────────────────────────

    /**
     * @param {number} deltaSeconds
     * @param {object} input
     * @param {number} input.ascentProgress - camera position along the path [0..1]
     * @param {object} [input.audio] - OdysseyAudioReactor state ({energy,bass,...})
     * @param {object} [input.blendState] - precomputed blend state (else computed here)
     * @returns {object} this.state
     */
    update(deltaSeconds, input = {}) {
        const dt = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
        this.time += dt;

        const ascentProgress = THREE.MathUtils.clamp(input.ascentProgress ?? 0, 0, 1);
        const audio = input.audio || null;

        const blendState = input.blendState
            || resolveChapterBlendState(ascentProgress, CHAPTER_CONFIGS, this.chapterPositions || undefined);
        this._lastBlendState = blendState;

        // ── Audio → master energy + beat pulse ──
        const audioEnergy = audio ? clamp01(audio.energy) : 0;
        const rate = audioEnergy >= this.energy ? ENERGY_ATTACK_RATE : ENERGY_RELEASE_RATE;
        this.energy = expApproach(this.energy, audioEnergy, rate, dt);
        if (audio?.beat) {
            this.beatPulse = 1;
        } else {
            this.beatPulse = expApproach(this.beatPulse, 0, PULSE_DECAY_RATE, dt);
        }

        // ── Journey ──
        const sourceProfile = getChapterProfile(blendState.sourceChapter);
        const targetProfile = getChapterProfile(blendState.targetChapter);
        const seamT = THREE.MathUtils.clamp(blendState.seamProgress || 0, 0, 1);

        // Detect boundary entry for event memory (consumed later).
        if (blendState.boundaryId && blendState.boundaryId !== this._lastBoundaryId) {
            this._lastBoundaryId = blendState.boundaryId;
        } else if (!blendState.boundaryId) {
            this._lastBoundaryId = null;
        }

        // ── Blend atmosphere (source → target by seamProgress) ──
        const atmo = this.state.atmosphere;
        const srcA = sourceProfile.atmosphere;
        const tgtA = targetProfile.atmosphere;

        this._scratchA.set(srcA.skyColor);
        this._scratchB.set(tgtA.skyColor);
        atmo.skyColor.copy(this._scratchA).lerp(this._scratchB, seamT);

        this._scratchA.set(srcA.fogColor);
        this._scratchB.set(tgtA.fogColor);
        atmo.fogColor.copy(this._scratchA).lerp(this._scratchB, seamT);

        this._scratchA.set(srcA.ambientLight);
        this._scratchB.set(tgtA.ambientLight);
        atmo.ambientColor.copy(this._scratchA).lerp(this._scratchB, seamT);

        this._scratchA.set(srcA.lightColor);
        this._scratchB.set(tgtA.lightColor);
        atmo.lightColor.copy(this._scratchA).lerp(this._scratchB, seamT);

        atmo.fogDensity = lerpNumber(srcA.fogDensity, tgtA.fogDensity, seamT);
        atmo.ambientIntensity = lerpNumber(srcA.ambientIntensity, tgtA.ambientIntensity, seamT);
        atmo.lightIntensity = lerpNumber(srcA.lightIntensity, tgtA.lightIntensity, seamT);
        atmo.exposure = lerpNumber(srcA.exposure, tgtA.exposure, seamT);

        atmo.lightDir.set(
            lerpNumber(srcA.lightDir[0], tgtA.lightDir[0], seamT),
            lerpNumber(srcA.lightDir[1], tgtA.lightDir[1], seamT),
            lerpNumber(srcA.lightDir[2], tgtA.lightDir[2], seamT),
        );
        if (atmo.lightDir.lengthSq() > 1e-6) atmo.lightDir.normalize();

        const boundary34 = this.chapterPositions?.[3];
        if (Number.isFinite(boundary34)) {
            const colourStart = boundary34 - SEAM_34_ALPINE_COLOUR_HALF_WIDTH;
            const colourEnd = boundary34 + SEAM_34_ALPINE_COLOUR_HALF_WIDTH;
            if (ascentProgress >= colourStart && ascentProgress <= colourEnd) {
                const surface3 = getChapterProfile(3).atmosphere;
                const mountains4 = getChapterProfile(4).atmosphere;
                const alpineBlend = smootherstep01(
                    (ascentProgress - colourStart) / (colourEnd - colourStart),
                );
                lerpColorViaBridge(
                    atmo.skyColor,
                    surface3.skyColor,
                    SEAM_34_ALPINE_BRIDGE.skyColor,
                    mountains4.skyColor,
                    alpineBlend,
                    this._scratchA,
                );
                lerpColorViaBridge(
                    atmo.fogColor,
                    surface3.fogColor,
                    SEAM_34_ALPINE_BRIDGE.fogColor,
                    mountains4.fogColor,
                    alpineBlend,
                    this._scratchA,
                );
                lerpColorViaBridge(
                    atmo.ambientColor,
                    surface3.ambientLight,
                    SEAM_34_ALPINE_BRIDGE.ambientLight,
                    mountains4.ambientLight,
                    alpineBlend,
                    this._scratchA,
                );
                atmo.ambientIntensity = lerpNumberViaBridge(
                    surface3.ambientIntensity,
                    SEAM_34_ALPINE_BRIDGE.ambientIntensity,
                    mountains4.ambientIntensity,
                    alpineBlend,
                );
                atmo.fogDensity = lerpNumberViaBridge(
                    surface3.fogDensity,
                    SEAM_34_ALPINE_BRIDGE.fogDensity,
                    mountains4.fogDensity,
                    alpineBlend,
                );
            }
        }

        // SEAM 4->5 colour bridge: Mountains' bright azure -> Sky-Drift's deeper blue via a
        // pale-cyan high-key midpoint (mirrors the 3->4 alpine bridge). Director-side atmo only.
        const boundary45 = this.chapterPositions?.[4];
        if (Number.isFinite(boundary45)) {
            const colourStart = boundary45 - SEAM_45_SKY_COLOUR_HALF_WIDTH;
            const colourEnd = boundary45 + SEAM_45_SKY_COLOUR_HALF_WIDTH;
            if (ascentProgress >= colourStart && ascentProgress <= colourEnd) {
                const mountains4 = getChapterProfile(4).atmosphere;
                const sky5 = getChapterProfile(5).atmosphere;
                const skyBlend = smootherstep01(
                    (ascentProgress - colourStart) / (colourEnd - colourStart),
                );
                lerpColorViaBridge(
                    atmo.skyColor,
                    mountains4.skyColor,
                    SEAM_45_SKY_BRIDGE.skyColor,
                    sky5.skyColor,
                    skyBlend,
                    this._scratchA,
                );
                lerpColorViaBridge(
                    atmo.fogColor,
                    mountains4.fogColor,
                    SEAM_45_SKY_BRIDGE.fogColor,
                    sky5.fogColor,
                    skyBlend,
                    this._scratchA,
                );
                lerpColorViaBridge(
                    atmo.ambientColor,
                    mountains4.ambientLight,
                    SEAM_45_SKY_BRIDGE.ambientLight,
                    sky5.ambientLight,
                    skyBlend,
                    this._scratchA,
                );
                atmo.ambientIntensity = lerpNumberViaBridge(
                    mountains4.ambientIntensity,
                    SEAM_45_SKY_BRIDGE.ambientIntensity,
                    sky5.ambientIntensity,
                    skyBlend,
                );
                atmo.fogDensity = lerpNumberViaBridge(
                    mountains4.fogDensity,
                    SEAM_45_SKY_BRIDGE.fogDensity,
                    sky5.fogDensity,
                    skyBlend,
                );
            }
        }

        // ── Blend camera framing (act → act by seamProgress) ──
        const boundary56 = this.chapterPositions?.[5];
        if (Number.isFinite(boundary56)) {
            const colourStart = boundary56 - SEAM_56_AURORA_COLOUR_HALF_WIDTH;
            const colourEnd = boundary56 + SEAM_56_AURORA_COLOUR_HALF_WIDTH;
            if (ascentProgress >= colourStart && ascentProgress <= colourEnd) {
                const sky5 = getChapterProfile(5).atmosphere;
                const space6 = getChapterProfile(6).atmosphere;
                const auroraBlend = smootherstep01(
                    (ascentProgress - colourStart) / (colourEnd - colourStart),
                );
                lerpColorViaBridge(
                    atmo.skyColor,
                    sky5.skyColor,
                    SEAM_56_AURORA_BRIDGE.skyColor,
                    space6.skyColor,
                    auroraBlend,
                    this._scratchA,
                );
                lerpColorViaBridge(
                    atmo.fogColor,
                    sky5.fogColor,
                    SEAM_56_AURORA_BRIDGE.fogColor,
                    space6.fogColor,
                    auroraBlend,
                    this._scratchA,
                );
                lerpColorViaBridge(
                    atmo.ambientColor,
                    sky5.ambientLight,
                    SEAM_56_AURORA_BRIDGE.ambientLight,
                    space6.ambientLight,
                    auroraBlend,
                    this._scratchA,
                );
                if (auroraBlend < 0.5) {
                    atmo.ambientIntensity = lerpNumber(
                        sky5.ambientIntensity,
                        SEAM_56_AURORA_BRIDGE.ambientIntensity,
                        smootherstep01(auroraBlend * 2),
                    );
                } else {
                    atmo.ambientIntensity = lerpNumber(
                        SEAM_56_AURORA_BRIDGE.ambientIntensity,
                        space6.ambientIntensity,
                        smootherstep01((auroraBlend - 0.5) * 2),
                    );
                }
                atmo.fogDensity = lerpNumber(
                    sky5.fogDensity,
                    space6.fogDensity,
                    auroraBlend ** 1.45,
                );
            }
        }

        const srcCam = getCameraProfileForChapter(blendState.sourceChapter);
        const tgtCam = getCameraProfileForChapter(blendState.targetChapter);
        const cam = this.state.camera;
        cam.followDistance = lerpNumber(srcCam.followDistance, tgtCam.followDistance, seamT);
        cam.fovBase = lerpNumber(srcCam.fovBase, tgtCam.fovBase, seamT);
        cam.sway = lerpNumber(srcCam.sway, tgtCam.sway, seamT);
        cam.bob = lerpNumber(srcCam.bob, tgtCam.bob, seamT);
        cam.drift = lerpNumber(srcCam.drift, tgtCam.drift, seamT);

        // ── Derived emphasis (forward-looking; harmless until consumed) ──
        const { energy } = this;
        const { beatPulse } = this;
        const { post } = this.state;
        post.bloom = 1 + (energy * 0.4) + (beatPulse * 0.15);
        post.grade = energy; // 0 calm → 1 warmed/intensified
        post.dof = 0;
        post.godRay = 0.4 + (energy * 0.4);

        const { path } = this.state;
        path.headGlow = 0.6 + (audio ? clamp01(audio.bass) : 0) * 0.4 + (beatPulse * 0.15);
        path.flowSpeed = lerpNumber(sourceProfile.path.flowSpeed, targetProfile.path.flowSpeed, seamT)
            * (0.85 + energy * 0.4);
        path.beatPulse = beatPulse;

        this.state.node.focalPulse = beatPulse;

        // ── Publish scalar state ──
        this.state.ascentProgress = ascentProgress;
        this.state.energy = energy;
        this.state.bass = audio ? clamp01(audio.bass) : 0;
        this.state.mid = audio ? clamp01(audio.mid) : 0;
        this.state.treble = audio ? clamp01(audio.treble) : 0;
        this.state.beat = !!audio?.beat;
        this.state.beatPulse = beatPulse;
        this.state.audioAvailable = !!audio?.available;
        this.state.activeChapter = blendState.activeChapter;
        this.state.sourceChapter = blendState.sourceChapter;
        this.state.targetChapter = blendState.targetChapter;
        this.state.seamProgress = seamT;
        this.state.rawSeamProgress = THREE.MathUtils.clamp(blendState.rawSeamProgress || seamT, 0, 1);
        this.state.seamPhase = Number.isFinite(blendState.seamPhase) ? blendState.seamPhase : 0;
        this.state.seamEnvelope = Number.isFinite(blendState.seamEnvelope) ? blendState.seamEnvelope : 0;
        this.state.inSeam = !!blendState.inSeam;
        this.state.boundaryId = blendState.boundaryId;
        this.state.boundaryPosition = blendState.boundaryPosition;
        this.state.seamWidth = blendState.seamWidth;
        this.state.act = getChapterProfile(blendState.activeChapter).act;

        return this.state;
    }

    getState() {
        return this.state;
    }

    dispose() {
        this._lastBlendState = null;
    }
}

function clamp01(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

export default OdysseyDirector;
