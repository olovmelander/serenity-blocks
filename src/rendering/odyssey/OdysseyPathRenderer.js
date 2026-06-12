/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview OdysseyPathRenderer - Renders the ascending path through chapters
 *
 * Creates a glowing 3D spline path that represents the player's odyssey
 * from Earth Core to Black Hole transcendence.
 *
 * WebGPU migration: the three glowing tubes (outer / core / glow) are now TSL
 * NodeMaterials built by odyssey-path-renderer.tsl.js (WebGPURenderer cannot render
 * raw GLSL THREE.ShaderMaterial). The variable-radius tube geometry, pathCurve, and the
 * full public API (buildPath/rebuildPath/update/triggerChapterTransition/pathCurve/…)
 * are unchanged; only the materials moved GLSL→TSL.
 */

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { buildOdysseyPathCurve } from './path-utils.js';
import {
    createPathOuterTSL,
    createPathCoreTSL,
    createPathGlowTSL,
    createPathChapterUniforms,
    ODYSSEY_PATH_CROSS_SECTION,
} from './odyssey-path-renderer.tsl.js';
import {
    ODYSSEY_CHAPTER_PROFILES,
} from './chapter-environments/shared/chapter-profile.js';

// ── Path-tube LOD ceilings (Batch 2 perf) ────────────────────────────────────────
// The path is ALWAYS ON (drawn in every chapter), so its resident vert count is paid
// every frame. The locked spec (ODYSSEY_PATH_CROSS_SECTION) and the live ODYSSEY_PATH_DATA
// over-tessellate it (up to 32/480 radial/tubular). Cap the live tube here so the
// polygonal silhouette is still smooth but ~half the verts are shed with negligible
// silhouette change. These are CEILINGS: any lower value supplied by pathData /
// ODYSSEY_PATH_CROSS_SECTION is still honoured (Math.min), so the API + cross-section
// consumers keep working. Tubular drives computeFrenetFrames(count) too — capping it
// here also halves the Frenet-frame work.
const PATH_LOD = Object.freeze({
    radialSegments: 16, // outer  (was up to 32)
    coreRadialSegments: 12, // core   (was up to 24)
    glowRadialSegments: 12, // glow   (was up to 20)
    tubularSegments: 256, // outer/core (was up to 480 / live 300)
    glowTubularSegments: 256, // glow   (was up to 320)
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
        this.pathCoreMesh = null; // Inner glowing core
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
        this._chapterWidthScales = [];
        // Shared TSL time uniform ticked once per frame; passed into every builder so
        // the existing update() loop drives all three tubes.
        this._uTime = uniform(0);
        // Per-tube builder uniform sets ({ uTime, uProgress, uTransition* }) wired into
        // applyTransitionUniforms()/update() so animation still ticks (TSL .value setter).
        this._outerUniforms = null;
        this._coreUniforms = null;
        this._glowUniforms = null;
        // QW12: applyTransitionUniforms() built a fresh [...].filter(Boolean) array per
        // call (twice/frame via updateChapterTransition). Build the targets array once
        // when the tubes are created and reuse it.
        this._transitionTargets = [];
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

        const width = [];
        for (let i = 0; i < 8; i += 1) {
            const profile = ODYSSEY_CHAPTER_PROFILES[i] || ODYSSEY_CHAPTER_PROFILES[0];
            width.push(Number.isFinite(profile.path.widthScale) ? profile.path.widthScale : 1);
        }

        this._chapterBounds = bounds.slice(0, 9);
        this._chapterWidthScales = width;
        // TSL per-chapter uniform set ({ uBounds[9], uBase[8], uEmissive[8], uStyle[8],
        // uFlow, uHead, uBeat }) shared by the outer / core / glow TSL builders.
        this._chapterUniforms = createPathChapterUniforms(bounds.slice(0, 9));
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

    _getChapterWidthScaleAt(t) {
        const x = THREE.MathUtils.clamp(t, 0, 1);
        const bounds = this._chapterBounds?.length ? this._chapterBounds : [0, 1];
        const widths = this._chapterWidthScales?.length ? this._chapterWidthScales : [1];

        for (let index = 0; index < Math.min(8, bounds.length - 1); index += 1) {
            const lo = bounds[index];
            const hi = bounds[index + 1];
            if (x >= lo && x <= hi) {
                const current = widths[index] ?? 1;
                const next = widths[Math.min(index + 1, widths.length - 1)] ?? current;
                const seam = 0.018;
                if (x > hi - seam && index < widths.length - 1) {
                    const mix = THREE.MathUtils.smoothstep(x, hi - seam, hi);
                    return THREE.MathUtils.lerp(current, next, mix);
                }
                return current;
            }
        }

        return widths[widths.length - 1] ?? 1;
    }

    _createVariableTubeGeometry(radius, radialSegments = 12, tubularSegments = 240) {
        const segments = Math.max(2, Math.floor(tubularSegments));
        const sides = Math.max(3, Math.floor(radialSegments));
        const vertexCount = (segments + 1) * (sides + 1);
        const positions = new Float32Array(vertexCount * 3);
        const normals = new Float32Array(vertexCount * 3);
        const uvs = new Float32Array(vertexCount * 2);
        const indices = [];
        const frames = this.pathCurve.computeFrenetFrames(segments, false);
        const point = new THREE.Vector3();
        const radial = new THREE.Vector3();

        for (let i = 0; i <= segments; i += 1) {
            const t = i / segments;
            this.pathCurve.getPointAt(t, point);
            const scaledRadius = radius * this._getChapterWidthScaleAt(t);

            for (let j = 0; j <= sides; j += 1) {
                const v = j / sides;
                const angle = v * Math.PI * 2;
                radial.copy(frames.normals[i]).multiplyScalar(Math.cos(angle));
                radial.addScaledVector(frames.binormals[i], Math.sin(angle)).normalize();

                const vertexIndex = i * (sides + 1) + j;
                const p3 = vertexIndex * 3;
                positions[p3] = point.x + radial.x * scaledRadius;
                positions[p3 + 1] = point.y + radial.y * scaledRadius;
                positions[p3 + 2] = point.z + radial.z * scaledRadius;
                normals[p3] = radial.x;
                normals[p3 + 1] = radial.y;
                normals[p3 + 2] = radial.z;

                const uvIndex = vertexIndex * 2;
                uvs[uvIndex] = t;
                uvs[uvIndex + 1] = v;
            }
        }

        for (let i = 0; i < segments; i += 1) {
            for (let j = 0; j < sides; j += 1) {
                const a = i * (sides + 1) + j;
                const b = (i + 1) * (sides + 1) + j;
                const c = (i + 1) * (sides + 1) + j + 1;
                const d = i * (sides + 1) + j + 1;
                indices.push(a, b, d, b, c, d);
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        geometry.setIndex(indices);
        geometry.computeBoundingSphere();
        return geometry;
    }

    /**
     * Build a TSL builder material, then swap in this renderer's variable-radius tube
     * geometry. The builders (odyssey-path-renderer.tsl.js) create a throwaway uniform
     * TubeGeometry/mesh on their own demo curve — we keep the builder's NodeMaterial +
     * returned uniform nodes, dispose its geometry, and mount the material on our
     * variable-radius geometry so the diegetic surface still maps over uv (x = along
     * path, y = around tube). Both the legacy and AAA paths route through here.
     * @param {Function} builder createPathOuterTSL / createPathCoreTSL / createPathGlowTSL
     * @param {THREE.BufferGeometry} geometry variable-radius tube geometry
     * @returns {{ mesh: THREE.Mesh, uniforms: object }}
     */
    _buildTSLTube(builder, geometry) {
        const built = builder(this._uTime, {
            chapter: this._chapterUniforms,
            curve: this.pathCurve,
        });
        // Discard the builder's throwaway demo geometry; mount its material on ours.
        built.geometry?.dispose?.();
        const mesh = new THREE.Mesh(geometry, built.material);
        mesh.name = built.mesh?.name || 'odyssey-path-tube';
        return { mesh, uniforms: built.uniforms };
    }

    createPathTube(pathData) {
        // ═══════════════════════════════════════════════════════════════════
        // OUTER PATH TUBE - Main visible path
        // ═══════════════════════════════════════════════════════════════════
        const outerRadius = pathData.radius || 0.6; // Increased from 0.3
        // Batch2 LOD: cap radial/tubular at PATH_LOD ceilings (the always-on tube sheds
        // ~half its verts with negligible silhouette change). Math.min keeps any lower
        // value supplied by pathData / the cross-section spec honoured. computeFrenetFrames
        // is driven by the (capped) tubular count inside _createVariableTubeGeometry.
        const geometry = this._createVariableTubeGeometry(
            outerRadius,
            Math.min(
                pathData.radialSegments || ODYSSEY_PATH_CROSS_SECTION.radialSegments,
                PATH_LOD.radialSegments,
            ),
            Math.min(
                pathData.segments || ODYSSEY_PATH_CROSS_SECTION.tubularSegments,
                PATH_LOD.tubularSegments,
            ),
        );

        // P3: the per-chapter diegetic colour/style branch (TSL NodeMaterial) replaces the
        // legacy orange→purple GLSL gradient — required on WebGPURenderer.
        const outer = this._buildTSLTube(createPathOuterTSL, geometry);
        this.pathMesh = outer.mesh;
        this._outerUniforms = outer.uniforms;
        this.scene.add(this.pathMesh);

        // ═══════════════════════════════════════════════════════════════════
        // INNER CORE - Bright glowing center line
        // ═══════════════════════════════════════════════════════════════════
        const coreRadius = outerRadius * 0.3; // Inner core is 30% of outer
        // Batch2 LOD: core sits inside the outer tube — fewer radial sides read fine and
        // the tubular count is capped to match the outer.
        const coreGeometry = this._createVariableTubeGeometry(
            coreRadius,
            Math.max(6, Math.min(
                Math.floor((pathData.radialSegments || ODYSSEY_PATH_CROSS_SECTION.radialSegments) * 0.75),
                PATH_LOD.coreRadialSegments,
            )),
            Math.min(
                pathData.segments || ODYSSEY_PATH_CROSS_SECTION.coreTubularSegments,
                PATH_LOD.tubularSegments,
            ),
        );

        const core = this._buildTSLTube(createPathCoreTSL, coreGeometry);
        this.pathCoreMesh = core.mesh;
        this._coreUniforms = core.uniforms;
        this.scene.add(this.pathCoreMesh);
    }

    createPathGlow(pathData) {
        // Batch2 LOD: the glow halo is a soft additive shell — radial/tubular caps are
        // invisible there. Math.min keeps lower pathData / cross-section values honoured.
        const geometry = this._createVariableTubeGeometry(
            (pathData.radius || 0.3) * 2,
            Math.max(6, Math.min(
                Math.floor(pathData.radialSegments || ODYSSEY_PATH_CROSS_SECTION.glowRadialSegments),
                PATH_LOD.glowRadialSegments,
            )),
            Math.min(
                pathData.segments || ODYSSEY_PATH_CROSS_SECTION.glowTubularSegments,
                PATH_LOD.glowTubularSegments,
            ),
        );

        const glow = this._buildTSLTube(createPathGlowTSL, geometry);
        this.pathGlowMesh = glow.mesh;
        this._glowUniforms = glow.uniforms;
        this.scene.add(this.pathGlowMesh);

        // QW12: build the applyTransitionUniforms targets array ONCE (was rebuilt per call).
        // createPathTube (outer+core) runs before createPathGlow in buildPath, so all three
        // uniform sets exist here.
        this._transitionTargets = [
            this._outerUniforms,
            this._coreUniforms,
            this._glowUniforms,
        ].filter(Boolean);
    }

    createChapterMarkers(chapterPositions) {
        chapterPositions.forEach((pos, index) => {
            if (index >= ODYSSEY_CHAPTER_PROFILES.length) {
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

        // Shared TSL time uniform drives all three tubes (outer/core/glow).
        this._uTime.value = this.time;

        // Per-tube progress (TSL uniform nodes returned by the builders).
        if (this._outerUniforms) this._outerUniforms.uProgress.value = this.progress;
        if (this._coreUniforms) this._coreUniforms.uProgress.value = this.progress;
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
            this.applyTransitionUniforms(0, 0.5, 0.08, this.transitionResetColor);
            this.chapterMarkers.forEach((ring, index) => {
                const { material } = ring;
                const chapterColor = this.getChapterColor(index + 1);
                material.emissive.copy(chapterColor);
                material.emissiveIntensity = 0.5;
                ring.scale.setScalar(1);
            });
            return;
        }

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

        if (this.pathCoreMesh) {
            this.pathCoreMesh.geometry.dispose();
            this.pathCoreMesh.material.dispose();
            this.scene.remove(this.pathCoreMesh);
            this.pathCoreMesh = null;
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
        this._coreUniforms = null;
        this._glowUniforms = null;
        this._transitionTargets = [];
        this._chapterUniforms = null;
    }
}

export default OdysseyPathRenderer;
