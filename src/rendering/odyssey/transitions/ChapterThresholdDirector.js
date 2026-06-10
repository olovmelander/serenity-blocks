/* eslint-disable import/no-unresolved */
/**
 * @fileoverview ChapterThresholdDirector
 *
 * Phase 5 of the Odyssey AAA overhaul: authored, continuous chapter breaches.
 * The director owns a compact set of prebuilt scene-space effects centered on
 * the chapter seam. Triggers only update state; no geometry is allocated while
 * the player crosses a boundary.
 */

import * as THREE from 'three/webgpu';
import {
    createVeilMaterialTSL,
    createRingMaterialTSL,
    createParticleMaterialTSL,
    createParticleGeometry,
} from './chapter-threshold-director.tsl.js';

const DEFAULT_PROFILE = Object.freeze({
    id: '1-2',
    name: 'Steam Quench',
    kind: 0,
    stinger: 'steam-quench',
    primary: 0xff6a22,
    secondary: 0x58d8ff,
    particle: 0xbdefff,
    ringScale: 1.0,
    veilScale: 1.0,
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
        ringScale: 0.95,
        veilScale: 1.0,
    }),
    '2-3': Object.freeze({
        id: '2-3',
        name: 'Surface Breach',
        kind: 1,
        stinger: 'surface-breach',
        primary: 0x4bd6ff,
        secondary: 0xfff1b8,
        particle: 0xffffff,
        ringScale: 1.08,
        veilScale: 1.1,
    }),
    '3-4': Object.freeze({
        id: '3-4',
        name: 'Ridgeline Rise',
        kind: 2,
        stinger: 'ridgeline-rise',
        primary: 0xa7e96a,
        secondary: 0xd9efff,
        particle: 0xe8f7ff,
        ringScale: 1.0,
        veilScale: 0.95,
    }),
    '4-5': Object.freeze({
        id: '4-5',
        name: 'Summit Liftoff',
        kind: 3,
        stinger: 'summit-liftoff',
        primary: 0xffd1b6,
        secondary: 0xaed6ff,
        particle: 0xf4fbff,
        ringScale: 1.18,
        veilScale: 1.25,
    }),
    '5-6': Object.freeze({
        id: '5-6',
        name: 'Atmosphere Edge',
        kind: 4,
        stinger: 'atmosphere-edge',
        primary: 0x9fd0ff,
        secondary: 0x1d2254,
        particle: 0xbddcff,
        ringScale: 1.35,
        veilScale: 1.3,
    }),
    '6-7': Object.freeze({
        id: '6-7',
        name: 'Lensing Engage',
        kind: 5,
        stinger: 'lensing-engage',
        primary: 0xb38bff,
        secondary: 0xff7a42,
        particle: 0xffc175,
        ringScale: 1.45,
        veilScale: 1.2,
    }),
    '7-8': Object.freeze({
        id: '7-8',
        name: 'Neon Snap',
        kind: 6,
        stinger: 'neon-snap',
        primary: 0xffffff,
        secondary: 0x00f0ff,
        particle: 0xff66c4,
        ringScale: 1.25,
        veilScale: 1.35,
    }),
});

export function getOdysseyThresholdProfile(boundaryId) {
    return ODYSSEY_THRESHOLD_PROFILES[boundaryId] || DEFAULT_PROFILE;
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

        // TSL/WebGPU materials. The veil builder constructs the shared uniform set
        // (TSL uniform() nodes expose .value get/set + .value.set() for colors, exactly
        // like the old THREE uniforms), which the ring + particles then share so a single
        // uTime/uProgress/etc. clock drives all three. trigger()/setSeamPhase()/update()
        // keep mutating this.uniforms.*.value unchanged.
        const veil = createVeilMaterialTSL();
        this.uniforms = veil.uniforms;
        this.veil = veil.mesh;
        this.veil.name = 'threshold-veil';
        this.veil.frustumCulled = false;
        this.group.add(this.veil);

        const ring = createRingMaterialTSL(this.uniforms.uTime, this.uniforms);
        this.ring = ring.mesh;
        this.ring.name = 'threshold-ring';
        this.ring.frustumCulled = false;
        this.group.add(this.ring);

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
        const intensity = env * this.active.intensity * (1 + energy * 0.35 + beat * 0.22);

        this.uniforms.uProgress.value = progress;
        this.uniforms.uIntensity.value = intensity;

        const offset = (easeOutCubic(progress) - 0.5) * 0.022 * this.active.direction;
        this._positionAt(this.active.boundaryPosition, offset);

        if (camera) {
            this.group.quaternion.copy(camera.quaternion);
        }

        const { profile } = this.active;
        const scale = 1 + env * 0.16 + energy * 0.05;
        this.veil.scale.setScalar(profile.veilScale * scale);
        this.ring.scale.setScalar(profile.ringScale * (0.75 + progress * 0.75 + env * 0.15));
        this.ring.rotation.z += deltaSeconds * (0.4 + profile.kind * 0.035) * this.active.direction;
        this.particles.scale.setScalar(1 + progress * 0.65 + beat * 0.08);

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
