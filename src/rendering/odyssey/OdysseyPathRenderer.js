/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview OdysseyPathRenderer - Renders the ascending path through chapters
 *
 * Creates a glowing 3D spline path that represents the player's odyssey
 * from Earth Core to Black Hole transcendence.
 *
 * The ribbon is two draws: an opaque BODY and an additive HAZE shell, both TSL
 * NodeMaterials built by odyssey-path-renderer.tsl.js on CENTRE-LINE geometry (the radius
 * is applied in the vertex shader so the ribbon can collapse near the lens, hold a pixel
 * floor in the distance and taper at its ends). The old third "core" tube sat entirely
 * inside the opaque body and was never visible; its hot centre line now lives in the body.
 * Public API (buildPath/rebuildPath/update/triggerChapterTransition/setSeamPhase/pathCurve/…)
 * is unchanged.
 */

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { buildOdysseyPathCurve } from './path-utils.js';
import {
    createPathOuterTSL,
    createPathGlowTSL,
    createPathChapterUniforms,
    createPathCentreLineGeometry,
    ODYSSEY_PATH_CROSS_SECTION,
} from './odyssey-path-renderer.tsl.js';
import {
    ODYSSEY_CHAPTER_PROFILES,
} from './chapter-environments/shared/chapter-profile.js';

// ── Path-tube tessellation ───────────────────────────────────────────────────────
// The path is ALWAYS ON (drawn in every chapter). Centre-line geometry: the radius lives in
// the vertex shader, so these counts only decide how smooth the spline reads. 1536 rings
// (~1.65 u apart over the 2533-u journey) remove the elbows 256 drew at every tight turn;
// the haze is a soft additive shell and keeps half that. Body 1536x8 + haze 768x6 =
// 33.8k triangles, replacing outer 256x8 + core 256x6 + glow 256x8 (11.3k) + 8 lit torus
// markers (4.1k): +18k triangles of trivially cheap vertex work for -1 draw / -1 pipeline
// here (and -8 draws / the only lit pipeline when the markers fold into the shader).
const PATH_LOD = Object.freeze({
    radialSegments: ODYSSEY_PATH_CROSS_SECTION.radialSegments,
    tubularSegments: ODYSSEY_PATH_CROSS_SECTION.tubularSegments,
    glowRadialSegments: ODYSSEY_PATH_CROSS_SECTION.glowRadialSegments,
    glowTubularSegments: ODYSSEY_PATH_CROSS_SECTION.glowTubularSegments,
});

/**
 * OdysseyPathRenderer - Renders the cosmic ascent path
 */
export class OdysseyPathRenderer {
    constructor(scene, options = {}) {
        this.scene = scene;
        this.aaa = !!options.aaa; // Diegetic per-chapter path styling.
        this.pathCurve = null;
        this.pathMesh = null;
        this.pathGlowMesh = null;
        this.chapterMarkers = [];
        this.progress = 0;
        this.time = 0;
        this.chapterTransition = null;
        this.positionSeam = null;
        this.transitionResetColor = new THREE.Color(0xffffff);
        // QW12: per-chapter THREE.Color cache. getChapterColor() ran new THREE.Color()
        // per marker inside an 8-ring forEach EVERY frame on the always-on path; the
        // colours are static-per-chapterId, so build them once. Lazily filled (length 8).
        this._chapterColorCache = [];
        this._chapterUniforms = null; // TSL per-chapter uniform set (createPathChapterUniforms)
        this._chapterBounds = [];
        // Shared TSL time uniform ticked once per frame; passed into every builder so
        // the existing update() loop drives all three tubes.
        this._uTime = uniform(0);
        // Per-tube builder uniform sets ({ uTime, uProgress, uTransition* }) wired into
        // applyTransitionUniforms()/update() so animation still ticks (TSL .value setter).
        this._outerUniforms = null;
        this._glowUniforms = null;
        // QW12: applyTransitionUniforms() built a fresh [...].filter(Boolean) array per
        // call (twice/frame via updateChapterTransition). Build the targets array once
        // when the tubes are created and reuse it.
        this._transitionTargets = [];
        // Perf (zero-visual): the steady-state (no-transition) branch of
        // updateChapterTransition re-wrote all 8 ring materials (emissive.copy +
        // emissiveIntensity + scale) AND the tube transition uniforms EVERY frame on the
        // always-on path, even though every write is idempotent at rest. This latch is
        // cleared whenever a transition branch runs, so the steady-state reset is applied
        // exactly ONCE per return-to-rest and then skipped — byte-identical end state.
        this._steadyStateApplied = false;
    }

    /**
     * Build shared per-chapter uniform values (bounds, base/emissive colours, style)
     * from the chapter profiles + the layout's chapter positions.
     * @param {number[]} chapterPositions
     */
    _buildChapterUniforms(chapterPositions = []) {
        const bounds = chapterPositions.filter((p) => Number.isFinite(p));
        // bounds must have 9 entries: 8 chapter starts + a trailing 1.0.
        while (bounds.length < 9) bounds.push(1);
        if (bounds[bounds.length - 1] < 1) bounds.push(1);

        this._chapterBounds = bounds.slice(0, 9);
        // TSL per-chapter uniform set ({ uBounds[9], uBase[8], uEmissive[8], uStyle[8],
        // uWidth[8], uArc, uFlow, uHead, uBeat }) shared by the body + haze builders. uArc
        // turns the arc parameter into world units so every pattern is sized in metres.
        this._chapterUniforms = createPathChapterUniforms(bounds.slice(0, 9), {
            arcLength: this.pathCurve?.getLength?.(),
        });
    }

    /**
     * Build the path from control points
     * @param {Object} pathData - Path configuration data
     */
    async buildPath(pathData) {
        this.pathCurve = buildOdysseyPathCurve(pathData);

        // P3: build per-chapter path uniforms (diegetic colour/style). Both the legacy and
        // AAA paths now route through the TSL builders (WebGPURenderer cannot render raw
        // GLSL ShaderMaterial), so the chapter uniform set is always built.
        this._buildChapterUniforms(pathData.chapterPositions);

        // Create tube geometry along path
        this.createPathTube(pathData);

        // Create outer glow tube
        this.createPathGlow(pathData);

        // Add chapter transition markers
        this.createChapterMarkers(pathData.chapterPositions);

        console.log('[OdysseyPath] Path built with', pathData.controlPoints.length, 'control points');
    }

    async rebuildPath(pathData) {
        const { progress } = this;
        this.dispose();
        await this.buildPath(pathData);
        this.setProgress(progress);
    }

    /**
     * Build a body/haze material on centre-line geometry (radius applied in-shader).
     * @param {Function} builder createPathOuterTSL / createPathGlowTSL
     * @param {THREE.BufferGeometry} geometry centre-line geometry
     * @param {number} radius body radius (the haze builder scales it by glowScale)
     * @returns {{ mesh: THREE.Mesh, uniforms: object }}
     */
    _buildTSLTube(builder, geometry, radius) {
        const built = builder(this._uTime, {
            chapter: this._chapterUniforms,
            curve: this.pathCurve,
            geometry,
            radius,
        });
        return { mesh: built.mesh, uniforms: built.uniforms };
    }

    createPathTube(pathData) {
        // BODY — the visible ribbon. Its hot centre line replaces the old core tube.
        const radius = pathData.radius || ODYSSEY_PATH_CROSS_SECTION.outerRadius;
        const geometry = createPathCentreLineGeometry(
            this.pathCurve,
            PATH_LOD.tubularSegments,
            PATH_LOD.radialSegments,
        );
        const outer = this._buildTSLTube(createPathOuterTSL, geometry, radius);
        this.pathMesh = outer.mesh;
        this._outerUniforms = outer.uniforms;
        this.scene.add(this.pathMesh);
    }

    createPathGlow(pathData) {
        // HAZE — the additive shell around the body.
        const radius = pathData.radius || ODYSSEY_PATH_CROSS_SECTION.outerRadius;
        const geometry = createPathCentreLineGeometry(
            this.pathCurve,
            PATH_LOD.glowTubularSegments,
            PATH_LOD.glowRadialSegments,
        );
        const glow = this._buildTSLTube(createPathGlowTSL, geometry, radius);
        this.pathGlowMesh = glow.mesh;
        this._glowUniforms = glow.uniforms;
        this.scene.add(this.pathGlowMesh);

        // QW12: build the applyTransitionUniforms targets array ONCE (was rebuilt per call).
        this._transitionTargets = [
            this._outerUniforms,
            this._glowUniforms,
        ].filter(Boolean);
    }

    createChapterMarkers(chapterPositions) {
        // Fresh rings (and, on rebuild, fresh tube uniform sets) start at the rest pose
        // but the tube transition uniforms still need their one-time reset applied — clear
        // the latch so updateChapterTransition re-applies the steady state once.
        this._steadyStateApplied = false;
        chapterPositions.forEach((pos, index) => {
            if (index >= ODYSSEY_CHAPTER_PROFILES.length) {
                return;
            }
            // Chapter 1 starts at the path's origin: there is no threshold to mark there, and
            // its ring sat on top of level 1's orb (ch1 shot 1).
            if (index === 0) {
                return;
            }
            const chapterColor = this.getChapterColor(index + 1);

            const point = this.pathCurve.getPointAt(pos);

            // Create ring marker. SELF-LIT via emissive: the body color is black so
            // the ring never depends on chapter lights (several chapters — Deep Ocean
            // among them — run with no local lights at all, which made the lit body
            // render as the "unlit black torus" flagged by the creative plan's Ch2
            // diagnosis). The emissive term renders without lights, and the seam code
            // animates material.emissive/emissiveIntensity, so the material MUST stay
            // MeshStandardMaterial (updateChapterTransition writes those every frame).
            const geometry = new THREE.TorusGeometry(1.5, 0.1, 8, 32);
            const material = new THREE.MeshStandardMaterial({
                color: 0x000000,
                emissive: chapterColor,
                emissiveIntensity: 0.5,
            });

            const ring = new THREE.Mesh(geometry, material);
            ring.position.copy(point);

            // Orient ring to face along path
            const tangent = this.pathCurve.getTangentAt(pos);
            ring.lookAt(point.clone().add(tangent));

            this.chapterMarkers.push(ring);
            this.scene.add(ring);
        });
    }

    /**
     * Set player progress along path
     * @param {number} normalizedProgress - 0 to 1
     */
    setProgress(normalizedProgress) {
        this.progress = THREE.MathUtils.clamp(normalizedProgress, 0, 1);
    }

    /**
     * Path position of the "current" node (the one to play next) — where the ribbon's
     * frontier spark sits. null → the spark follows the lit frontier (setProgress).
     * @param {number|null} position
     */
    setFocus(position) {
        this.focus = Number.isFinite(position) ? THREE.MathUtils.clamp(position, 0, 1) : null;
    }

    getChapterColor(chapterId) {
        // QW12: return a cached per-chapter THREE.Color (built once) instead of allocating
        // a new THREE.Color on every call. This is called ~8×/frame on the always-on path
        // (marker forEach in updateChapterTransition). Callers treat the result as
        // read-only (they .copy()/.lerp()/feed it to material ctors which copy the value),
        // so sharing the cached instance is safe.
        const len = ODYSSEY_CHAPTER_PROFILES.length;
        const idx = (((chapterId - 1) % len) + len) % len; // safe modulo for any chapterId
        let cached = this._chapterColorCache[idx];
        if (!cached) {
            const profile = ODYSSEY_CHAPTER_PROFILES[idx] || ODYSSEY_CHAPTER_PROFILES[0];
            cached = new THREE.Color(
                profile.path?.emissiveColor ?? profile.palette?.accent ?? 0xffffff,
            );
            this._chapterColorCache[idx] = cached;
        }
        return cached;
    }

    triggerChapterTransition({
        fromChapter,
        toChapter,
        direction = 1,
        boundaryPosition = 0.5,
        durationMs = 850,
    } = {}) {
        this.chapterTransition = {
            active: true,
            startTime: performance.now(),
            duration: Math.max(1, durationMs),
            direction: Math.sign(direction) || 1,
            fromChapter,
            toChapter,
            boundaryPosition: THREE.MathUtils.clamp(boundaryPosition ?? 0.5, 0, 1),
            incomingColor: this.getChapterColor(toChapter || fromChapter || 1),
        };
    }

    setSeamPhase({
        boundaryId,
        fromChapter,
        toChapter,
        boundaryPosition = 0.5,
        seamWidth = 0.018,
        seamPhase = 0,
        envelope = 0,
    } = {}) {
        if (!boundaryId) return;
        this.positionSeam = {
            active: true,
            boundaryId,
            fromChapter,
            toChapter,
            boundaryPosition: THREE.MathUtils.clamp(boundaryPosition ?? 0.5, 0, 1),
            width: Math.max(0.006, seamWidth || 0.018),
            seamPhase: THREE.MathUtils.clamp(seamPhase || 0, -1, 1),
            envelope: THREE.MathUtils.clamp(envelope || 0, 0, 1),
            incomingColor: this.getChapterColor(toChapter || fromChapter || 1),
        };
    }

    clearSeamPhase() {
        this.positionSeam = null;
    }

    /**
     * Get position on path at normalized t
     * @param {number} t - 0 to 1
     * @returns {THREE.Vector3}
     */
    getPointAt(t) {
        return this.pathCurve?.getPointAt(THREE.MathUtils.clamp(t, 0, 1));
    }

    /**
     * Update animation
     * @param {number} deltaTime
     * @param {object} [directorState] - OdysseyDirector.getState() (AAA flow/beat)
     */
    update(deltaTime, directorState = null) {
        this.time += deltaTime;

        // Shared TSL time uniform drives both tubes (body/haze).
        this._uTime.value = this.time;

        // Per-tube progress (TSL uniform nodes returned by the builders).
        if (this._outerUniforms) this._outerUniforms.uProgress.value = this.progress;
        if (this._glowUniforms) this._glowUniforms.uProgress.value = this.progress;

        // P3: drive the diegetic flow toward the head + beat pulse from director state.
        if (this.aaa && this._chapterUniforms) {
            this._chapterUniforms.uHead.value = this.progress;
            this._chapterUniforms.uFlow.value = directorState?.path?.flowSpeed ?? 0;
            this._chapterUniforms.uBeat.value = directorState?.path?.beatPulse ?? 0;
        }

        this.updateChapterTransition();

        // Rotate chapter markers subtly
        this.chapterMarkers.forEach((ring, i) => {
            ring.rotation.z += deltaTime * 0.2 * (i % 2 === 0 ? 1 : -1);
        });
    }

    updateChapterTransition() {
        if (this.positionSeam?.active) {
            // A transition is animating the rings/uniforms — invalidate the steady-state
            // latch so the rest pose is re-applied once when this branch stops running.
            this._steadyStateApplied = false;
            const seam = this.positionSeam;
            const envelope = THREE.MathUtils.clamp(seam.envelope, 0, 1);
            this.applyTransitionUniforms(
                envelope,
                seam.boundaryPosition,
                Math.max(0.006, seam.width),
                seam.incomingColor,
            );

            this.chapterMarkers.forEach((ring, index) => {
                const chapterId = index + 1;
                const { material } = ring;
                const chapterColor = this.getChapterColor(chapterId);
                material.emissive.copy(chapterColor);
                if (chapterId === seam.toChapter) {
                    material.emissive.lerp(seam.incomingColor, 0.4);
                    material.emissiveIntensity = 0.5 + envelope * 1.15;
                    ring.scale.setScalar(1 + envelope * 0.26);
                } else if (chapterId === seam.fromChapter) {
                    material.emissiveIntensity = 0.5 + envelope * 0.45;
                    ring.scale.setScalar(1 + envelope * 0.12);
                } else {
                    material.emissiveIntensity = 0.5;
                    ring.scale.setScalar(1);
                }
            });
            return;
        }

        if (!this.chapterTransition?.active) {
            // Steady state: every write below is idempotent at rest, so apply the rest
            // pose exactly ONCE per return-to-rest and skip it on subsequent frames. The
            // latch is cleared by the two transition branches (and on rebuild via
            // createChapterMarkers), so a fresh transition still re-applies the rest pose
            // afterward — byte-identical end state, no per-frame material churn idle.
            if (this._steadyStateApplied) {
                return;
            }
            this.applyTransitionUniforms(0, 0.5, 0.08, this.transitionResetColor);
            this.chapterMarkers.forEach((ring, index) => {
                const { material } = ring;
                const chapterColor = this.getChapterColor(index + 1);
                material.emissive.copy(chapterColor);
                material.emissiveIntensity = 0.5;
                ring.scale.setScalar(1);
            });
            this._steadyStateApplied = true;
            return;
        }

        // A transition is animating the rings/uniforms — invalidate the steady-state
        // latch so the rest pose is re-applied once when this branch stops running.
        this._steadyStateApplied = false;
        const elapsed = performance.now() - this.chapterTransition.startTime;
        const rawProgress = THREE.MathUtils.clamp(elapsed / this.chapterTransition.duration, 0, 1);
        const envelope = Math.sin(rawProgress * Math.PI);
        const head = THREE.MathUtils.clamp(
            this.chapterTransition.boundaryPosition
                + (rawProgress - 0.35) * 0.18 * this.chapterTransition.direction,
            0,
            1,
        );
        this.applyTransitionUniforms(
            envelope,
            head,
            0.08 + ((1 - rawProgress) * 0.04),
            this.chapterTransition.incomingColor,
        );

        this.chapterMarkers.forEach((ring, index) => {
            const chapterId = index + 1;
            const { material } = ring;
            const chapterColor = this.getChapterColor(chapterId);
            material.emissive.copy(chapterColor);
            if (chapterId === this.chapterTransition.toChapter) {
                material.emissive.lerp(this.chapterTransition.incomingColor, 0.35);
                material.emissiveIntensity = 0.5 + (envelope * 1.1);
                ring.scale.setScalar(1 + (envelope * 0.25));
            } else if (chapterId === this.chapterTransition.fromChapter) {
                material.emissiveIntensity = 0.5 + (envelope * 0.45);
                ring.scale.setScalar(1 + (envelope * 0.12));
            } else {
                material.emissiveIntensity = 0.5;
                ring.scale.setScalar(1);
            }
        });

        if (rawProgress >= 1) {
            this.chapterTransition.active = false;
        }
    }

    applyTransitionUniforms(transitionMix, head, width, color) {
        // QW12: reuse the prebuilt targets array (this._transitionTargets, populated in
        // createPathTube/createPathGlow) instead of allocating a fresh
        // [...].filter(Boolean) array on every call.
        const targets = this._transitionTargets;
        for (let i = 0; i < targets.length; i += 1) {
            const uniforms = targets[i];
            uniforms.uTransitionMix.value = transitionMix;
            uniforms.uTransitionHead.value = head;
            uniforms.uTransitionWidth.value = width;
            uniforms.uTransitionColor.value.copy(color);
        }
    }

    /**
     * Dispose resources
     */
    dispose() {
        if (this.pathMesh) {
            this.pathMesh.geometry.dispose();
            this.pathMesh.material.dispose();
            this.scene.remove(this.pathMesh);
            this.pathMesh = null;
        }

        if (this.pathGlowMesh) {
            this.pathGlowMesh.geometry.dispose();
            this.pathGlowMesh.material.dispose();
            this.scene.remove(this.pathGlowMesh);
            this.pathGlowMesh = null;
        }

        this.chapterMarkers.forEach((ring) => {
            ring.geometry.dispose();
            ring.material.dispose();
            this.scene.remove(ring);
        });
        this.chapterMarkers = [];
        this.pathCurve = null;
        this.positionSeam = null;
        this.chapterTransition = null;
        this._outerUniforms = null;
        this._glowUniforms = null;
        this._transitionTargets = [];
        this._chapterUniforms = null;
        this._steadyStateApplied = false;
    }
}

export default OdysseyPathRenderer;
