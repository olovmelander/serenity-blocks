/**
 * @fileoverview OdysseyCameraController - Camera navigation for Odyssey Board
 *
 * Handles camera movement, zoom, and transitions along the path.
 * Supports follow mode, free mode, and focused node viewing.
 */

import * as THREE from 'three';
import { ODYSSEY_PATH_DATA } from './path-data.js';

const DEFAULT_CHAPTER_POSITIONS = ODYSSEY_PATH_DATA.chapterPositions || [0, 1];
const CHAPTER_1_LOOK_DOWN = new THREE.Vector3(0, -26, 0);
const CHAPTER_1_LOOK_FADE_RANGE = 0.035;
const FREE_CAMERA_WORLD_UP = new THREE.Vector3(0, 1, 0);

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

        // Configuration
        this.config = {
            followOffset: new THREE.Vector3(0, -1, 18), // More straight camera angle
            followLerpSpeed: 0.03,
            scrollSpeed: 0.15, // Reduced from 0.5
            focusDistance: 10,
            minPosition: 0, // Allow scrolling all the way to Level 1
            maxPosition: 1, // Allow scrolling all the way to the end
            magneticRadius: 0.015, // Distance to feel magnetic pull
            magneticFriction: 0.2, // Multiplier for speed when near a level
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
            count,
        };

        const point = new THREE.Vector3();
        const tangent = new THREE.Vector3();

        for (let i = 0; i < count; i++) {
            const t = i / (count - 1);
            this.pathCurve.getPointAt(t, point);
            this.pathCurve.getTangentAt(t, tangent).normalize();

            const idx = i * 3;
            this.pathLut.positions[idx] = point.x;
            this.pathLut.positions[idx + 1] = point.y;
            this.pathLut.positions[idx + 2] = point.z;

            this.pathLut.tangents[idx] = tangent.x;
            this.pathLut.tangents[idx + 1] = tangent.y;
            this.pathLut.tangents[idx + 2] = tangent.z;
        }
    }

    /**
     * Get interpolated path position and tangent from LUT
     * @param {number} t - 0 to 1
     * @param {THREE.Vector3} [optionalTargetPos]
     * @param {THREE.Vector3} [optionalTargetTangent]
     * @returns {{position: THREE.Vector3, tangent: THREE.Vector3}}
     */
    getPathDataAt(t, optionalTargetPos, optionalTargetTangent) {
        const clampedT = THREE.MathUtils.clamp(t, 0, 1);
        const count = this.pathLut.count;
        const rawIdx = clampedT * (count - 1);
        const i0 = Math.floor(rawIdx);
        const i1 = Math.min(i0 + 1, count - 1);
        const lerp = rawIdx - i0;

        const pos = optionalTargetPos || new THREE.Vector3();
        const tan = optionalTargetTangent || new THREE.Vector3();

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

        return { position: pos, tangent: tan };
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
    }

    findNearestLevel(position) {
        if (!this.levelPositions.length) return null;

        // Binary search for nearest position in sorted array
        let low = 0;
        let high = this.levelPositions.length - 1;

        while (low <= high) {
            const mid = (low + high) >>> 1;
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

        // Apply cinematic breathing effects
        this.applyBreathingMotion(deltaTime);

        // Update FOV pulse
        this.updateFovPulse(deltaTime);

        // Free camera is driven directly from its quaternion to avoid lookAt singularities.
        if (this.mode === 'free') {
            this.camera.quaternion.copy(this.freeCameraQuaternion);
            this.camera.updateMatrixWorld(true);
            return;
        }

        this.camera.up.copy(FREE_CAMERA_WORLD_UP);
        this.camera.lookAt(this.lookAtTarget);
    }

    /**
     * Apply subtle breathing motion (sway, bob, roll)
     * @param {number} deltaTime
     */
    applyBreathingMotion(deltaTime) {
        const cc = this.cinematicConfig;
        const t = this.breatheTime;
        const seamWeight = this.getSeamBeatStrength();

        // Don't apply during rapid animations (focus/zoom)
        if (this.mode === 'free' || this.portalApproach?.active || (this.isAnimating && this.mode === 'focus')) return;

        // Horizontal sway (dreamlike drift)
        if (cc.swayEnabled) {
            const sway = Math.sin(t * Math.PI * 2 * cc.swayFrequency) * cc.swayAmplitude;
            this.camera.position.x += sway * deltaTime * 2; // Smooth application
        }

        // Vertical bob (gentle float)
        if (cc.bobEnabled) {
            const bob = Math.sin(t * Math.PI * 2 * cc.bobFrequency + Math.PI * 0.5) * cc.bobAmplitude;
            this.camera.position.y += bob * deltaTime * 2;
        }

        // Camera roll (very subtle tilt)
        if (cc.rollEnabled) {
            const rollAmplitude = cc.rollAmplitude * (1 - (seamWeight * 0.82));
            const roll = Math.sin(t * Math.PI * 2 * cc.rollFrequency) * rollAmplitude;
            this.camera.rotation.z = roll;
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

    updateFollow(deltaTime) {
        // Lerp current position toward target
        const lerpFactor = 1 - (1 - this.config.followLerpSpeed) ** (deltaTime * 60);
        this.currentPosition = THREE.MathUtils.lerp(
            this.currentPosition,
            this.targetPosition,
            lerpFactor,
        );

        this.updateFollowPosition({ direct: false });
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
        const { position: pathPoint, tangent } = this.getPathDataAt(clampedPosition);
        const seamWeight = this.getSeamBeatStrength();
        const seamDirection = this.seamBeat?.direction || 1;
        const forwardOffset = 1.15 * seamWeight * (this.seamBeat?.intensity || 0);

        const camPos = pathPoint.clone().add(this.config.followOffset);
        if (forwardOffset > 0) {
            camPos.addScaledVector(tangent, forwardOffset * seamDirection);
        }

        const lookAheadDistance = this.cinematicConfig.lookAheadEnabled
            ? this.cinematicConfig.lookAheadDistance
            : 0.01;
        const lookAheadT = THREE.MathUtils.clamp(
            clampedPosition + (lookAheadDistance * (forwardOffset > 0 ? 1.4 : 1)),
            0,
            1,
        );
        const { position: lookTarget } = this.getPathDataAt(lookAheadT);
        if (forwardOffset > 0) {
            lookTarget.addScaledVector(tangent, forwardOffset * 0.45 * seamDirection);
        }
        lookTarget.add(this.getLookAtOffset(clampedPosition));

        return { camPos, lookTarget, tangent };
    }

    updateFollowPosition(options = {}) {
        const {
            position = this.currentPosition,
            direct = false,
            positionBlend = 0.1,
            lookBlend = 0.1,
        } = options;

        const { camPos, lookTarget } = this.computeFollowFrame(position);

        if (direct) {
            this.camera.position.copy(camPos);
            this.lookAtTarget.copy(lookTarget);
            return;
        }

        this.camera.position.lerp(camPos, positionBlend);
        this.lookAtTarget.lerp(lookTarget, lookBlend);
    }

    getLookAtOffset(position) {
        if (position >= this.chapter1EndPosition) {
            return this.lookAtOffset.set(0, 0, 0);
        }

        const fadeStart = Math.max(0, this.chapter1EndPosition - CHAPTER_1_LOOK_FADE_RANGE);
        const fade = CHAPTER_1_LOOK_FADE_RANGE > 0
            ? 1 - THREE.MathUtils.smoothstep(position, fadeStart, this.chapter1EndPosition)
            : 1;

        return this.lookAtOffset.copy(CHAPTER_1_LOOK_DOWN).multiplyScalar(fade);
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

        this.camera.rotation.z = roll;
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

    getSeamBeatStrength() {
        if (!this.seamBeat?.active) return 0;

        const elapsed = performance.now() - this.seamBeat.startTime;
        const t = THREE.MathUtils.clamp(elapsed / this.seamBeat.duration, 0, 1);
        const envelope = Math.sin(t * Math.PI);
        return envelope * (this.seamBeat.intensity || 0);
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
