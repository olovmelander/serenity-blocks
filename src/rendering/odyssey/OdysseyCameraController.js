/**
 * @fileoverview OdysseyCameraController - Camera navigation for Odyssey Board
 *
 * Handles camera movement, zoom, and transitions along the path.
 * Supports follow mode, free mode, and focused node viewing.
 */

import * as THREE from 'three';
import { ODYSSEY_PATH_DATA } from './path-data.js';

const CHAPTER_1_END_POSITION = ODYSSEY_PATH_DATA.chapterPositions?.[1] ?? 0.125;
const CHAPTER_1_LOOK_DOWN = new THREE.Vector3(0, -6, 0);
const CHAPTER_1_LOOK_FADE_RANGE = 0.02;

/**
 * OdysseyCameraController - Camera navigation along the odyssey path
 */
export class OdysseyCameraController {
    constructor(camera, pathCurve) {
        this.camera = camera;
        this.pathCurve = pathCurve;

        // State
        this.mode = 'follow'; // 'follow' | 'free' | 'focus'
        this.currentPosition = 0; // 0-1 along path - start at Level 1
        this.targetPosition = 0;
        this.lookAtTarget = new THREE.Vector3();
        this.lookAtOffset = new THREE.Vector3();

        // Animation state
        this.isAnimating = false;
        this.animationStartTime = 0;
        this.animationDuration = 0;
        this.animationStartPos = new THREE.Vector3();
        this.animationEndPos = new THREE.Vector3();
        this.animationStartLookAt = new THREE.Vector3();
        this.animationEndLookAt = new THREE.Vector3();
        this.portalApproach = null;

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
        this.lastChapterId = 1;

        // Initialize camera position
        this.updateFollowPosition();
    }

    /**
     * Scroll along the path
     * @param {number} delta - Scroll amount (-1 to 1)
     */
    scroll(delta) {
        if (this.mode === 'focus') {
            // Exit focus mode on scroll
            this.mode = 'follow';
            this.isAnimating = false;
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
        let minDist = Infinity;
        let nearest = null;

        // Optimization: We could binary search, but iterating ~60 items is negligible
        // We can just check the relevant chapter's levels if we had chapter info handy,
        // but simple loop is fine for this scale.
        for (const levelPos of ODYSSEY_PATH_DATA.levelPositions) {
            const dist = Math.abs(position - levelPos);
            if (dist < minDist) {
                minDist = dist;
                nearest = levelPos;
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
    panToPosition(position, duration = 1500) {
        this.mode = 'follow';
        this.targetPosition = THREE.MathUtils.clamp(
            position,
            this.config.minPosition,
            this.config.maxPosition,
        );

        // Start smooth animation
        this.isAnimating = true;
        this.animationStartTime = performance.now();
        this.animationDuration = duration;
        this.animationStartPos.copy(this.camera.position);

        // Calculate end position
        const pathPoint = this.pathCurve.getPointAt(this.targetPosition);
        this.animationEndPos.copy(pathPoint).add(this.config.followOffset);

        this.animationStartLookAt.copy(this.lookAtTarget);
        this.animationEndLookAt.copy(pathPoint).add(this.getLookAtOffset(this.targetPosition));
    }

    /**
     * Focus camera on a specific node position
     * @param {THREE.Vector3} nodePosition
     * @param {number} duration - Animation duration in ms
     */
    focusOnNode(nodePosition, duration = 800) {
        this.mode = 'focus';
        this.isAnimating = true;
        this.animationStartTime = performance.now();
        this.animationDuration = duration;

        this.animationStartPos.copy(this.camera.position);
        this.animationEndPos.copy(nodePosition).add(new THREE.Vector3(0, 2, this.config.focusDistance));

        this.animationStartLookAt.copy(this.lookAtTarget);
        this.animationEndLookAt.copy(nodePosition);
    }

    /**
     * Rapid zoom into a position (for dramatic level entry)
     * @param {THREE.Vector3} targetPosition - Position to zoom toward
     * @param {number} duration - Animation duration in ms
     */
    zoomToPosition(targetPosition, duration = 600) {
        this.portalApproach = null;
        this.mode = 'focus';
        this.isAnimating = true;
        this.animationStartTime = performance.now();
        this.animationDuration = duration;

        this.animationStartPos.copy(this.camera.position);

        // Zoom very close to the position (almost inside it)
        const zoomOffset = new THREE.Vector3(0, 0, 1); // Very close
        this.animationEndPos.copy(targetPosition).add(zoomOffset);

        this.animationStartLookAt.copy(this.lookAtTarget);
        this.animationEndLookAt.copy(targetPosition);

        console.log('[Camera] Zooming to position', targetPosition);
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
        this.isAnimating = true;
        this.animationStartTime = performance.now();
        this.animationDuration = duration;

        this.animationStartPos.copy(this.camera.position);

        // Move camera closer along the look direction
        const direction = new THREE.Vector3();
        this.camera.getWorldDirection(direction);
        this.animationEndPos.copy(this.camera.position).addScaledVector(direction, this.config.focusDistance * factor);

        this.animationStartLookAt.copy(this.lookAtTarget);
        this.animationEndLookAt.copy(this.lookAtTarget);
    }

    /**
     * Update camera each frame
     * @param {number} deltaTime
     */
    update(deltaTime) {
        // Update breathing time
        this.breatheTime += deltaTime;

        if (this.portalApproach?.active) {
            this.updatePortalApproach();
        } else if (this.isAnimating) {
            this.updateAnimation();
        } else if (this.mode === 'follow') {
            this.updateFollow(deltaTime);
        }

        // Apply cinematic breathing effects
        this.applyBreathingMotion(deltaTime);

        // Update FOV pulse
        this.updateFovPulse(deltaTime);

        // Always look at target
        this.camera.lookAt(this.lookAtTarget);
    }

    /**
     * Apply subtle breathing motion (sway, bob, roll)
     * @param {number} deltaTime
     */
    applyBreathingMotion(deltaTime) {
        const cc = this.cinematicConfig;
        const t = this.breatheTime;

        // Don't apply during rapid animations (focus/zoom)
        if (this.portalApproach?.active || (this.isAnimating && this.mode === 'focus')) return;

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
            const roll = Math.sin(t * Math.PI * 2 * cc.rollFrequency) * cc.rollAmplitude;
            this.camera.rotation.z = roll;
        }
    }

    /**
     * Update FOV pulse animation
     * @param {number} deltaTime
     */
    updateFovPulse(deltaTime) {
        const cc = this.cinematicConfig;
        if (!cc.fovPulseEnabled || !this.fovPulseActive || this.portalApproach?.active) return;

        const elapsed = (performance.now() - this.fovPulseStartTime) / 1000;
        const t = Math.min(elapsed / cc.fovPulseDuration, 1);

        // Smooth ease-out curve
        const eased = 1 - (1 - t) ** 3;

        if (this.fovPulseType === 'expand') {
            // Expand then contract
            const pulseT = t < 0.4 ? t / 0.4 : 1 - (t - 0.4) / 0.6;
            const smoothPulse = Math.sin(pulseT * Math.PI) * cc.fovPulseAmount;
            this.camera.fov = cc.baseFov + smoothPulse;
        } else {
            // Just contract (tunnel effect)
            const smoothPulse = (1 - eased) * cc.fovPulseAmount;
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
    triggerFovPulse(type = 'expand') {
        if (!this.cinematicConfig.fovPulseEnabled) return;

        this.fovPulseActive = true;
        this.fovPulseStartTime = performance.now();
        this.fovPulseType = type;
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

    updateFollow(deltaTime) {
        // Lerp current position toward target
        const lerpFactor = 1 - (1 - this.config.followLerpSpeed) ** (deltaTime * 60);
        this.currentPosition = THREE.MathUtils.lerp(
            this.currentPosition,
            this.targetPosition,
            lerpFactor,
        );

        this.updateFollowPosition();
    }

    updateFollowPosition() {
        // Get point on path
        const pathPoint = this.pathCurve.getPointAt(this.currentPosition);

        // Get tangent for camera orientation
        const tangent = this.pathCurve.getTangentAt(this.currentPosition);

        // Position camera with offset
        const camPos = pathPoint.clone().add(this.config.followOffset);

        // Smooth camera movement
        this.camera.position.lerp(camPos, 0.1);

        // Look only slightly ahead on path (reduced from 0.05 to 0.01)
        const lookAheadT = Math.min(1, this.currentPosition + 0.01);
        const lookTarget = this.pathCurve.getPointAt(lookAheadT);
        lookTarget.add(this.getLookAtOffset(this.currentPosition));
        this.lookAtTarget.lerp(lookTarget, 0.1);
    }

    getLookAtOffset(position) {
        if (position >= CHAPTER_1_END_POSITION) {
            return this.lookAtOffset.set(0, 0, 0);
        }

        const fadeStart = Math.max(0, CHAPTER_1_END_POSITION - CHAPTER_1_LOOK_FADE_RANGE);
        const fade = CHAPTER_1_LOOK_FADE_RANGE > 0
            ? 1 - THREE.MathUtils.smoothstep(position, fadeStart, CHAPTER_1_END_POSITION)
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

        // End animation
        if (elapsed >= this.animationDuration) {
            this.isAnimating = false;
            if (this.mode === 'follow') {
                this.currentPosition = this.targetPosition;
            }
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

    /**
     * Set mode to follow
     */
    setFollowMode() {
        this.mode = 'follow';
        this.isAnimating = false;
        this.portalApproach = null;
    }

    /**
     * Get current position along path
     * @returns {number} 0 to 1
     */
    getCurrentPosition() {
        return this.currentPosition;
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
}

export default OdysseyCameraController;
