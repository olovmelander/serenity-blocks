/* eslint-disable import/no-unresolved */
/**
 * @fileoverview ChapterThresholdDirector
 *
 * Phase 5 of the Odyssey AAA overhaul: authored, continuous chapter breaches.
 * The director owns a compact set of prebuilt scene-space effects centered on
 * the chapter seam. Triggers only update state; no geometry is allocated while
 * the player crosses a boundary.
 *
 * ⚠️ SEAMLESS PASS (2026-10-02): EVERY OVERLAY IS OFF, AT EVERY SEAM. The veil (an additive
 * 32x20 quad), the scanning ring (a torus) and the 180 rail particles were non-diegetic
 * graphics laid over the world, and the camera flew THROUGH them: the 4->5 "Summit Liftoff"
 * lavender flash (luma 193 at p 0.3709) was the eye passing the veil plane and its particle
 * cloud, the 2->3 waterline band and ring floated in the sky after the breach, and 1->2 drew a
 * ring circle over the ocean at p 0.0749. Each seam now carries something IN the world instead
 * (embers -> bubbles -> spray, cloud tops -> cloud sea, omen -> Gargantua, accretion light -> the
 * city's sun). So every profile authors veilScale = ringScale = particleScale = 0, and a
 * component no profile asks for is NOT BUILT: zero meshes, zero materials, zero pipelines at
 * warm-up and zero draws at a seam (was 3 draws: quad + torus + 180-instance burst). The class
 * stays — it still resolves the profiles the audio stingers read, keeps the trigger/seam-phase
 * API the board calls, and re-builds a component if a future profile authors a scale again.
 */

import * as THREE from 'three/webgpu';
import {
    createVeilMaterialTSL,
    createRingMaterialTSL,
    createParticleMaterialTSL,
    createParticleGeometry,
    makeThresholdUniforms,
} from './chapter-threshold-director.tsl.js';

const DEFAULT_PROFILE = Object.freeze({
    id: '1-2',
    name: 'Steam Quench',
    kind: 0,
    stinger: 'steam-quench',
    primary: 0xff6a22,
    secondary: 0x58d8ff,
    particle: 0xbdefff,
    ringScale: 0,
    veilScale: 0,
    particleScale: 0,
});

export const ODYSSEY_THRESHOLD_PROFILES = Object.freeze({
    '1-2': Object.freeze({
        id: '1-2',
        name: 'Steam Quench',
        kind: 0,
        stinger: 'steam-quench',
        primary: 0xff6a22,
        secondary: 0x58d8ff,
        particle: 0xc7f4ff,
        ringScale: 0,
        veilScale: 0,
        particleScale: 0,
    }),
    '2-3': Object.freeze({
        id: '2-3',
        name: 'Surface Breach',
        kind: 1,
        stinger: 'surface-breach',
        primary: 0x4bd6ff,
        secondary: 0xfff1b8,
        particle: 0xffffff,
        ringScale: 0,
        veilScale: 0,
        particleScale: 0,
    }),
    '3-4': Object.freeze({
        id: '3-4',
        name: 'Ridgeline Rise',
        kind: 2,
        stinger: 'ridgeline-rise',
        primary: 0x9cc7b8,
        secondary: 0xc8dded,
        particle: 0xe8f7ff,
        ringScale: 0,
        veilScale: 0,
        particleScale: 0,
        intensityScale: 0.24,
    }),
    '4-5': Object.freeze({
        id: '4-5',
        name: 'Summit Liftoff',
        kind: 3,
        stinger: 'summit-liftoff',
        primary: 0xffd1b6,
        secondary: 0xaed6ff,
        particle: 0xf4fbff,
        ringScale: 0,
        veilScale: 0,
        particleScale: 0,
    }),
    '5-6': Object.freeze({
        id: '5-6',
        name: 'Atmosphere Edge',
        kind: 4,
        stinger: 'atmosphere-edge',
        // Creative plan (6→ Transition In, beat 2) authored the veil as the olive-green
        // AIRGLOW membrane the camera punches through. Seamless pass: it drew as a hard teal
        // bar across the frame (p 0.7363-0.7643), so the membrane is now the world's own
        // airglow -> aurora carry and this profile draws nothing. Colours kept for the API.
        primary: 0x68d8c8,
        secondary: 0x06162f,
        particle: 0x174e66,
        ringScale: 0,
        veilScale: 0,
        particleScale: 0,
    }),
    // QUIETED 2026-10-01 (masterpiece pass). Chapter 6's omen now IS chapter 7's Gargantua and
    // glides onto its pose across the seam, so the black hole itself carries the handoff. The
    // old violet ring (1.45) and orange veil (1.2) flooded the frame around p 0.878-0.886 — a
    // magenta wash over the very disk the seam is about. The gold accent that replaced it is
    // gone too (seamless pass): the black hole carries this seam on its own.
    '6-7': Object.freeze({
        id: '6-7',
        name: 'Lensing Engage',
        kind: 5,
        stinger: 'lensing-engage',
        primary: 0xffe2b8,
        secondary: 0xff9a52,
        particle: 0xffd29a,
        ringScale: 0,
        veilScale: 0,
        particleScale: 0,
        intensityScale: 0.35,
    }),
    '7-8': Object.freeze({
        id: '7-8',
        name: 'Neon Snap',
        kind: 6,
        stinger: 'neon-snap',
        primary: 0xffffff,
        secondary: 0x00f0ff,
        particle: 0xff66c4,
        ringScale: 0,
        veilScale: 0,
        particleScale: 0,
    }),
});

export function getOdysseyThresholdProfile(boundaryId) {
    return ODYSSEY_THRESHOLD_PROFILES[boundaryId] || DEFAULT_PROFILE;
}

/**
 * Whether any authored profile draws the given overlay component. Missing keys keep their
 * historical default (particleScale defaulted to 1), so an omitted scale is never silently 0.
 * @param {'veilScale'|'ringScale'|'particleScale'} key
 * @returns {boolean}
 */
export function thresholdComponentAuthored(key) {
    return [DEFAULT_PROFILE, ...Object.values(ODYSSEY_THRESHOLD_PROFILES)]
        .some((profile) => (profile[key] ?? 1) > 0.001);
}

function easeOutCubic(t) {
    const inv = 1 - THREE.MathUtils.clamp(t, 0, 1);
    return 1 - inv * inv * inv;
}

function envelope(t) {
    const clamped = THREE.MathUtils.clamp(t, 0, 1);
    return Math.sin(clamped * Math.PI);
}

export class ChapterThresholdDirector {
    constructor(scene, pathCurve, options = {}) {
        this.scene = scene;
        this.pathCurve = pathCurve || null;
        this.chapterPositions = Array.isArray(options.chapterPositions) ? [...options.chapterPositions] : [];
        this.qualityName = options.qualityName || 'High';
        this.time = 0;
        this.active = null;

        this.group = new THREE.Group();
        this.group.name = 'odyssey-threshold-director';
        this.group.visible = false;
        this.group.renderOrder = 80;

        // TSL/WebGPU materials share ONE uniform set (TSL uniform() nodes expose .value
        // get/set + .value.set() for colors, exactly like the old THREE uniforms) so a single
        // uTime/uProgress/etc. clock drives every component. trigger()/setSeamPhase()/update()
        // keep mutating this.uniforms.*.value whether or not any component is built.
        // Components no profile authors are not built at all (see the header) — null here.
        this.uniforms = makeThresholdUniforms();
        this.veil = null;
        this.ring = null;
        this.particles = null;

        if (thresholdComponentAuthored('veilScale')) {
            const veil = createVeilMaterialTSL(this.uniforms.uTime, this.uniforms);
            this.veil = veil.mesh;
            this.veil.name = 'threshold-veil';
            this.veil.frustumCulled = false;
            this.group.add(this.veil);
        }

        if (thresholdComponentAuthored('ringScale')) {
            const ring = createRingMaterialTSL(this.uniforms.uTime, this.uniforms);
            this.ring = ring.mesh;
            this.ring.name = 'threshold-ring';
            this.ring.frustumCulled = false;
            this.group.add(this.ring);
        }

        if (thresholdComponentAuthored('particleScale')) {
            const particleCount = this.qualityName === 'Minimal' || this.qualityName === 'Low' ? 96 : 180;
            const particles = createParticleMaterialTSL(this.uniforms.uTime, this.uniforms);
            // createParticleMaterialTSL builds a 180-instance geometry by default; rebuild on the
            // quality-resolved count (mirrors createThresholdBreachPilotTSL's override).
            if (particleCount !== 180) {
                particles.geometry.dispose();
                particles.geometry = createParticleGeometry(particleCount);
                particles.mesh.geometry = particles.geometry;
            }
            this.particles = particles.mesh;
            this.particles.name = 'threshold-particles';
            this.particles.frustumCulled = false;
            this.group.add(this.particles);
        }

        this._scratchPosition = new THREE.Vector3();
        this._scratchTangent = new THREE.Vector3(0, 1, 0);

        if (this.scene) {
            this.scene.add(this.group);
        }
    }

    setPathCurve(pathCurve) {
        this.pathCurve = pathCurve || null;
    }

    setChapterPositions(chapterPositions = []) {
        this.chapterPositions = Array.isArray(chapterPositions)
            ? chapterPositions.filter((position) => Number.isFinite(position))
            : [];
    }

    trigger({
        boundaryId,
        boundaryPosition = null,
        durationMs = 900,
        direction = 1,
        intensity = 1,
    } = {}) {
        const profile = getOdysseyThresholdProfile(boundaryId);
        const resolvedBoundary = Number.isFinite(boundaryPosition)
            ? boundaryPosition
            : this._resolveBoundaryPosition(boundaryId);

        this.active = {
            boundaryId: profile.id,
            profile,
            boundaryPosition: THREE.MathUtils.clamp(resolvedBoundary ?? 0.5, 0, 1),
            startTime: performance.now(),
            duration: Math.max(1, durationMs),
            direction: Math.sign(direction) || 1,
            intensity: THREE.MathUtils.clamp(intensity, 0.2, 1.8),
            positionDriven: false,
            progress: 0,
            envelope: 0,
        };

        this.uniforms.uKind.value = profile.kind;
        this.uniforms.uPrimary.value.set(profile.primary);
        this.uniforms.uSecondary.value.set(profile.secondary);
        this.uniforms.uParticle.value.set(profile.particle);
        this.uniforms.uDirection.value = this.active.direction;
        this.uniforms.uProgress.value = 0;
        this.uniforms.uIntensity.value = 0;

        this._positionAt(this.active.boundaryPosition, 0);
        this.group.visible = true;
    }

    setSeamPhase({
        boundaryId,
        boundaryPosition = null,
        seamProgress = 0,
        seamPhase = 0,
        envelope: seamEnvelope = 0,
        direction = 1,
        intensity = 1,
    } = {}) {
        if (!boundaryId) return;

        const profile = getOdysseyThresholdProfile(boundaryId);
        const resolvedBoundary = Number.isFinite(boundaryPosition)
            ? boundaryPosition
            : this._resolveBoundaryPosition(boundaryId);

        if (!this.active || this.active.boundaryId !== profile.id || !this.active.positionDriven) {
            this.active = {
                boundaryId: profile.id,
                profile,
                boundaryPosition: THREE.MathUtils.clamp(resolvedBoundary ?? 0.5, 0, 1),
                startTime: performance.now(),
                duration: 1,
                direction: Math.sign(direction) || 1,
                intensity: THREE.MathUtils.clamp(intensity, 0.2, 1.8),
                positionDriven: true,
                progress: 0,
                seamPhase: 0,
                envelope: 0,
            };
            this.uniforms.uKind.value = profile.kind;
            this.uniforms.uPrimary.value.set(profile.primary);
            this.uniforms.uSecondary.value.set(profile.secondary);
            this.uniforms.uParticle.value.set(profile.particle);
            this.group.visible = true;
        }

        this.active.boundaryPosition = THREE.MathUtils.clamp(resolvedBoundary ?? 0.5, 0, 1);
        this.active.direction = Math.sign(direction) || 1;
        this.active.intensity = THREE.MathUtils.clamp(intensity, 0.2, 1.8);
        this.active.progress = THREE.MathUtils.clamp(seamProgress ?? ((seamPhase + 1) * 0.5), 0, 1);
        this.active.seamPhase = THREE.MathUtils.clamp(seamPhase || 0, -1, 1);
        this.active.envelope = THREE.MathUtils.clamp(seamEnvelope || 0, 0, 1);
        this.uniforms.uDirection.value = this.active.direction;
    }

    clearSeamPhase() {
        if (this.active?.positionDriven) {
            this.active = null;
            this.group.visible = false;
            this.uniforms.uIntensity.value = 0;
        }
    }

    update(deltaSeconds = 0, camera = null, directorState = null) {
        this.time += Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
        this.uniforms.uTime.value = this.time;

        if (!this.active) {
            this.uniforms.uIntensity.value = 0;
            this.group.visible = false;
            return;
        }

        const elapsed = performance.now() - this.active.startTime;
        const progress = this.active.positionDriven
            ? THREE.MathUtils.clamp(this.active.progress, 0, 1)
            : THREE.MathUtils.clamp(elapsed / this.active.duration, 0, 1);
        const env = this.active.positionDriven
            ? THREE.MathUtils.clamp(this.active.envelope, 0, 1)
            : envelope(progress);
        const beat = THREE.MathUtils.clamp(directorState?.beatPulse || 0, 0, 1);
        const energy = THREE.MathUtils.clamp(directorState?.energy || 0, 0, 1);
        const { profile } = this.active;
        const profileIntensityScale = profile.intensityScale ?? 1;
        const intensity = env
            * this.active.intensity
            * profileIntensityScale
            * (1 + energy * 0.35 + beat * 0.22);

        this.uniforms.uProgress.value = progress;
        this.uniforms.uIntensity.value = intensity;

        const offset = (easeOutCubic(progress) - 0.5) * 0.022 * this.active.direction;
        this._positionAt(this.active.boundaryPosition, offset);

        if (camera) {
            this.group.quaternion.copy(camera.quaternion);
        }

        const scale = 1 + env * 0.16 + energy * 0.05;
        const veilScale = profile.veilScale ?? 1.0;
        const ringScale = profile.ringScale ?? 1.0;
        const particleScale = profile.particleScale ?? 1.0;
        if (this.veil) {
            this.veil.visible = veilScale > 0.001;
            this.veil.scale.setScalar(veilScale * scale);
        }
        if (this.ring) {
            this.ring.visible = ringScale > 0.001;
            this.ring.scale.setScalar(ringScale * (0.75 + progress * 0.75 + env * 0.15));
            this.ring.rotation.z += deltaSeconds * (0.4 + profile.kind * 0.035) * this.active.direction;
        }
        if (this.particles) {
            this.particles.visible = particleScale > 0.001;
            this.particles.scale.setScalar((1 + progress * 0.65 + beat * 0.08) * particleScale);
        }
        // Nothing to draw this seam: keep the (empty or all-hidden) group out of the render list.
        this.group.visible = !!((this.veil?.visible) || (this.ring?.visible) || (this.particles?.visible));

        if (!this.active.positionDriven && progress >= 1) {
            this.active = null;
            this.group.visible = false;
            this.uniforms.uIntensity.value = 0;
        }
    }

    getActiveBoundaryId() {
        return this.active?.boundaryId || null;
    }

    _resolveBoundaryPosition(boundaryId) {
        if (typeof boundaryId !== 'string') return 0.5;
        const sourceChapter = Number.parseInt(boundaryId.split('-')[0], 10);
        const position = this.chapterPositions[sourceChapter];
        return Number.isFinite(position) ? position : 0.5;
    }

    _positionAt(progress, offset = 0) {
        const t = THREE.MathUtils.clamp(progress + offset, 0, 1);
        if (this.pathCurve?.getPointAt) {
            this.pathCurve.getPointAt(t, this._scratchPosition);
            if (this.pathCurve.getTangentAt) {
                this.pathCurve.getTangentAt(t, this._scratchTangent).normalize();
            }
        } else {
            this._scratchPosition.set(0, 0, 0);
            this._scratchTangent.set(0, 1, 0);
        }

        this.group.position.copy(this._scratchPosition);
        this.group.position.addScaledVector(this._scratchTangent, 0.8);
    }

    dispose() {
        if (this.scene && this.group.parent === this.scene) {
            this.scene.remove(this.group);
        }

        this.group.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
        this.active = null;
    }
}

export default ChapterThresholdDirector;
