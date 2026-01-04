/**
 * @fileoverview JourneyCameraController - Camera navigation for Journey Board
 *
 * Handles camera movement, zoom, and transitions along the path.
 * Supports follow mode, free mode, and focused node viewing.
 */

import * as THREE from 'three';
import { JOURNEY_PATH_DATA } from './path-data.js';

const CHAPTER_1_END_POSITION = JOURNEY_PATH_DATA.chapterPositions?.[1] ?? 0.125;
const CHAPTER_1_LOOK_DOWN = new THREE.Vector3(0, -6, 0);
const CHAPTER_1_LOOK_FADE_RANGE = 0.02;

/**
 * JourneyCameraController - Camera navigation along the journey path
 */
export class JourneyCameraController {
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

        // Configuration
        this.config = {
            followOffset: new THREE.Vector3(0, -1, 18), // More straight camera angle
            followLerpSpeed: 0.03,
            scrollSpeed: 0.15, // Reduced from 0.5
            focusDistance: 10,
            minPosition: 0,    // Allow scrolling all the way to Level 1
            maxPosition: 1,    // Allow scrolling all the way to the end
            magneticRadius: 0.015, // Distance to feel magnetic pull
            magneticFriction: 0.2, // Multiplier for speed when near a level
        };

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
                const movingAway = (delta > 0 && this.targetPosition > nearestLevel) ||
                    (delta < 0 && this.targetPosition < nearestLevel);

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
        for (const levelPos of JOURNEY_PATH_DATA.levelPositions) {
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
        if (this.isAnimating) {
            this.updateAnimation();
        } else if (this.mode === 'follow') {
            this.updateFollow(deltaTime);
        }

        // Always look at target
        this.camera.lookAt(this.lookAtTarget);
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

    /**
     * Set mode to follow
     */
    setFollowMode() {
        this.mode = 'follow';
        this.isAnimating = false;
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

export default JourneyCameraController;
