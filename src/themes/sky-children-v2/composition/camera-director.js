/* eslint-disable import/no-extraneous-dependencies */
/**
 * Sky Children V2 AAA — Camera Director
 *
 * Cinematic camera choreography for the cloud-sea high cinematic vantage.
 * Spring-recoil based movement, pointer parallax, Lissajous idle drift,
 * and FOV punches.
 */
import * as THREE from 'three';

const DEFAULT_FOCUS = new THREE.Vector3(0, 24, -380);
const REST_POSITION = new THREE.Vector3(0, 100, 150);

const SPRING_FREQ = 1.1; // Hz — slow, weighty
const SPRING_DAMP = 1.0; // critically damped
const MAX_FOV_DELTA = 5; // degrees
const MAX_OFFSET_LEN = 14; // world units

// Pointer parallax
const POINTER_ORBIT_X = 18;
const POINTER_ORBIT_Y = 9;
const POINTER_ORBIT_Z = 7;
const POINTER_LOOKAT_GAIN = 0.25;
const POINTER_DAMP_RATE = 2.4;

// Idle figure-8 (Lissajous)
const IDLE_X_PERIOD = 24;
const IDLE_Y_PERIOD = 33;
const IDLE_X_AMP = 7.0;
const IDLE_Y_AMP = 3.2;

export class CameraDirector {
    constructor(camera, focus = DEFAULT_FOCUS) {
        this.camera = camera;
        this.focus = focus.clone();

        this.restPosition = REST_POSITION.clone();
        this.restFov = camera.fov;

        this._targetPos = REST_POSITION.clone();
        this._targetFov = camera.fov;
        this._currentPos = REST_POSITION.clone();
        this._currentFov = camera.fov;
        this._velocity = new THREE.Vector3();
        this._fovVelocity = 0;

        this._eventOffset = new THREE.Vector3();
        this._eventOffsetTarget = new THREE.Vector3();
        this._eventFovDelta = 0;
        this._eventFovDeltaTarget = 0;

        this._idlePhase = Math.random() * Math.PI * 2;

        this._pointerTargetX = 0;
        this._pointerTargetY = 0;
        this._pointerX = 0;
        this._pointerY = 0;

        this._shakeAmp = 0;
        this._shakeDecayPerMs = 0;

        this._lookAt = new THREE.Vector3();
        this._tmp = new THREE.Vector3();
    }

    /** Quick decaying shake for percussive events. Amplitude in world units. */
    shake(amplitude = 0.6, durationMs = 140) {
        if (amplitude <= this._shakeAmp) return;
        this._shakeAmp = amplitude;
        this._shakeDecayPerMs = amplitude / Math.max(16, durationMs);
    }

    /** Quick FOV punch (degrees) that springs back. */
    fovPunch(delta = -1.5) {
        if (Math.abs(delta) <= Math.abs(this._eventFovDeltaTarget)) return;
        this._eventFovDeltaTarget = delta;
    }

    setPointer(x, y) {
        this._pointerTargetX = Math.max(-1, Math.min(1, x));
        this._pointerTargetY = Math.max(-1, Math.min(1, y));
    }

    /** Dolly toward (negative = away from) the focus by `distance` units. */
    dolly(distance) {
        this._tmp.copy(this.focus).sub(this.camera.position).normalize().multiplyScalar(distance);
        this._eventOffsetTarget.add(this._tmp);
    }

    /** Pull back for game over / quiet moments. */
    pullBack(distance = 22) {
        this._eventOffsetTarget.z += distance;
    }

    update(delta) {
        // 1. Idle figure-8 drift.
        this._idlePhase += delta;
        const idleX = Math.sin((this._idlePhase / IDLE_X_PERIOD) * Math.PI * 2) * IDLE_X_AMP;
        const idleY = Math.sin((this._idlePhase / IDLE_Y_PERIOD) * Math.PI * 2) * IDLE_Y_AMP;
        this._targetPos.copy(this.restPosition);
        this._targetPos.x += idleX;
        this._targetPos.y += idleY;

        // 2. Pointer parallax (frame-rate-independent damping).
        const pointerDamp = 1 - Math.exp(-POINTER_DAMP_RATE * delta);
        this._pointerX += (this._pointerTargetX - this._pointerX) * pointerDamp;
        this._pointerY += (this._pointerTargetY - this._pointerY) * pointerDamp;
        this._targetPos.x += this._pointerX * POINTER_ORBIT_X;
        this._targetPos.y += -this._pointerY * POINTER_ORBIT_Y;
        this._targetPos.z += Math.abs(this._pointerY) * POINTER_ORBIT_Z;

        // 3. Event offset — decays to 0.
        this._eventOffsetTarget.multiplyScalar(0.92);
        this._eventOffset.lerp(this._eventOffsetTarget, 0.14);
        if (this._eventOffset.lengthSq() > MAX_OFFSET_LEN * MAX_OFFSET_LEN) {
            this._eventOffset.setLength(MAX_OFFSET_LEN);
        }
        this._targetPos.add(this._eventOffset);

        // 4. FOV target.
        this._eventFovDeltaTarget *= 0.92;
        this._eventFovDelta += (this._eventFovDeltaTarget - this._eventFovDelta) * 0.14;
        const clampedFovDelta = Math.max(-MAX_FOV_DELTA, Math.min(MAX_FOV_DELTA, this._eventFovDelta));
        this._targetFov = this.restFov + clampedFovDelta;

        // 5. Positional spring.
        const k = (2 * Math.PI * SPRING_FREQ) ** 2;
        const c = 2 * SPRING_DAMP * Math.sqrt(k);
        this._tmp.copy(this._targetPos).sub(this._currentPos).multiplyScalar(k);
        this._tmp.addScaledVector(this._velocity, -c);
        this._velocity.addScaledVector(this._tmp, delta);
        this._currentPos.addScaledVector(this._velocity, delta);

        // 6. FOV spring.
        const fovError = this._targetFov - this._currentFov;
        const fovAccel = k * fovError - c * this._fovVelocity;
        this._fovVelocity += fovAccel * delta;
        this._currentFov += this._fovVelocity * delta;

        // 7. Look-at with pointer drift.
        this._lookAt.copy(this.focus);
        this._lookAt.x += this._pointerX * POINTER_ORBIT_X * POINTER_LOOKAT_GAIN;
        this._lookAt.y += -this._pointerY * POINTER_ORBIT_Y * POINTER_LOOKAT_GAIN;

        // 8. Apply + micro-shake.
        this.camera.position.copy(this._currentPos);
        if (this._shakeAmp > 0.0001) {
            this.camera.position.x += (Math.random() - 0.5) * this._shakeAmp * 2;
            this.camera.position.y += (Math.random() - 0.5) * this._shakeAmp * 2;
            this._shakeAmp = Math.max(0, this._shakeAmp - this._shakeDecayPerMs * (delta * 1000));
        }
        this.camera.lookAt(this._lookAt);
        if (Math.abs(this.camera.fov - this._currentFov) > 0.01) {
            this.camera.fov = this._currentFov;
            this.camera.updateProjectionMatrix();
        }
    }

    /**
     * Apply a per-event "punch" from the director's cameraPunch scalar (0..1):
     * a dolly-push toward the focus + FOV pull, scaled by strength.
     */
    punchFromDirector(strength = 0) {
        if (strength <= 0.001) return;
        this.dolly(strength * 6);
        this.fovPunch(-strength * 3.5);
        this.shake(strength * 0.8, 160);
    }

    snapToRest() {
        this._currentPos.copy(this.restPosition);
        this._targetPos.copy(this.restPosition);
        this._velocity.set(0, 0, 0);
        this._currentFov = this.restFov;
        this._targetFov = this.restFov;
        this._fovVelocity = 0;
        this._eventOffset.set(0, 0, 0);
        this._eventOffsetTarget.set(0, 0, 0);
        this._eventFovDelta = 0;
        this._eventFovDeltaTarget = 0;
        this._pointerX = 0;
        this._pointerY = 0;
        this._pointerTargetX = 0;
        this._pointerTargetY = 0;
        this.camera.position.copy(this._currentPos);
        this.camera.lookAt(this.focus);
        this.camera.fov = this._currentFov;
        this.camera.updateProjectionMatrix();
    }
}
