/* eslint-disable import/no-extraneous-dependencies */
/**
 * Starlight — Camera Director
 *
 * Copied from electric-dreams-v3/composition/camera-director.js. Pure-CPU
 * cinematic camera: slow Lissajous idle float + pointer-driven orbital parallax
 * (so the depth shells parallax against each other) + spring-damped, clamped
 * event impulses (dolly / vertigo / fovPunch / shake / pullBack).
 *
 * Only the REST_POSITION is tuned vs edv3: pulled to a wider, calmer canopy
 * framing for a sky-as-subject theme (no board-centric fluid mass to hug).
 *
 * Design constraints: max 0.5u displacement, max 6° FOV delta → no motion
 * sickness; all deltas critically damped (no overshoot/oscillation).
 */
import * as THREE from 'three';

const DEFAULT_FOCUS = new THREE.Vector3(0, 0, 0);
// Wider/calmer than edv3 (which hugs a board-centric fluid mass). The sky is the
// subject here, so we sit back and let the canopy breathe.
const REST_POSITION = new THREE.Vector3(0, 0.4, 14);

const SPRING_FREQ = 1.4; // Hz — slow, weighty camera feel
const SPRING_DAMP = 1.0; // Critically damped
const MAX_FOV_DELTA = 6; // degrees
const MAX_OFFSET_LEN = 0.5; // units

// Pointer-driven orbital parallax (NDC [-1,1] → arcs around the focal point).
const POINTER_ORBIT_X = 1.8;
const POINTER_ORBIT_Y = 1.1;
const POINTER_ORBIT_Z = 0.6;
const POINTER_LOOKAT_GAIN = 0.28;
const POINTER_DAMP_RATE = 2.6; // s^-1

// Lissajous idle float — period and amplitude per axis (subtle "breathing").
const IDLE_X_PERIOD = 18;
const IDLE_Y_PERIOD = 27;
const IDLE_X_AMP = 0.25;
const IDLE_Y_AMP = 0.18;

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

        this._trackTarget = focus.clone();
        this._trackBlend = 0;

        this._pointerTargetX = 0;
        this._pointerTargetY = 0;
        this._pointerX = 0;
        this._pointerY = 0;

        this._shakeAmp = 0;
        this._shakeDecayPerMs = 0;

        this._lookAt = new THREE.Vector3();
        this._tmp = new THREE.Vector3();
    }

    shake(amplitude = 0.04, durationMs = 120) {
        if (amplitude <= this._shakeAmp) return;
        this._shakeAmp = amplitude;
        this._shakeDecayPerMs = amplitude / Math.max(16, durationMs);
    }

    fovPunch(delta = -1.5) {
        if (Math.abs(delta) <= Math.abs(this._eventFovDeltaTarget)) return;
        this._eventFovDeltaTarget = delta;
    }

    setPointer(x, y) {
        this._pointerTargetX = Math.max(-1, Math.min(1, x));
        this._pointerTargetY = Math.max(-1, Math.min(1, y));
    }

    update(delta) {
        // 1. Idle figure-8 dolly
        this._idlePhase += delta;
        const idleX = Math.sin((this._idlePhase / IDLE_X_PERIOD) * Math.PI * 2) * IDLE_X_AMP;
        const idleY = Math.sin((this._idlePhase / IDLE_Y_PERIOD) * Math.PI * 2) * IDLE_Y_AMP;
        this._targetPos.copy(this.restPosition);
        this._targetPos.x += idleX;
        this._targetPos.y += idleY;

        // 2. Pointer-driven orbital parallax (frame-rate-independent damping).
        const pointerDamp = 1 - Math.exp(-POINTER_DAMP_RATE * delta);
        this._pointerX += (this._pointerTargetX - this._pointerX) * pointerDamp;
        this._pointerY += (this._pointerTargetY - this._pointerY) * pointerDamp;
        this._targetPos.x += this._pointerX * POINTER_ORBIT_X;
        this._targetPos.y += -this._pointerY * POINTER_ORBIT_Y;
        this._targetPos.z += Math.abs(this._pointerY) * POINTER_ORBIT_Z;

        // 3. Event offset — decays back to 0, clamped. Delta-normalized so the settle
        //    feel matches at 60/120/144 Hz (the fixed 0.92/0.14 per-frame constants,
        //    referenced to 60 Hz, become exp/1-exp of delta).
        const eventDecay = Math.exp(-5.0 * delta); // ≈0.92 per frame at 60 Hz
        const eventLerp = 1 - Math.exp(-9.0 * delta); // ≈0.14 per frame at 60 Hz
        this._eventOffsetTarget.multiplyScalar(eventDecay);
        this._eventOffset.lerp(this._eventOffsetTarget, eventLerp);
        if (this._eventOffset.lengthSq() > MAX_OFFSET_LEN * MAX_OFFSET_LEN) {
            this._eventOffset.setLength(MAX_OFFSET_LEN);
        }
        this._targetPos.add(this._eventOffset);

        // 4. FOV target — base + event delta, clamped (same delta-normalized settle).
        this._eventFovDeltaTarget *= eventDecay;
        this._eventFovDelta += (this._eventFovDeltaTarget - this._eventFovDelta) * eventLerp;
        const clampedFovDelta = Math.max(-MAX_FOV_DELTA, Math.min(MAX_FOV_DELTA, this._eventFovDelta));
        this._targetFov = this.restFov + clampedFovDelta;

        // 5. Spring damping toward target (positional).
        const k = (2 * Math.PI * SPRING_FREQ) ** 2;
        const c = 2 * SPRING_DAMP * Math.sqrt(k);
        this._tmp.copy(this._targetPos).sub(this._currentPos).multiplyScalar(k);
        this._tmp.addScaledVector(this._velocity, -c);
        this._velocity.addScaledVector(this._tmp, delta);
        this._currentPos.addScaledVector(this._velocity, delta);

        // 6. FOV damping (1D spring).
        const fovError = this._targetFov - this._currentFov;
        const fovAccel = k * fovError - c * this._fovVelocity;
        this._fovVelocity += fovAccel * delta;
        this._currentFov += this._fovVelocity * delta;

        // 7. Look-at point — focal + small pointer-driven drift (intentional framing).
        this._lookAt.copy(this.focus);
        this._lookAt.x += this._pointerX * POINTER_ORBIT_X * POINTER_LOOKAT_GAIN;
        this._lookAt.y += -this._pointerY * POINTER_ORBIT_Y * POINTER_LOOKAT_GAIN;

        // 8. Apply to camera + micro-shake jitter (post-spring).
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

    punch(worldPoint, strength = 0.2) {
        this._tmp.copy(worldPoint).sub(this.camera.position).normalize().multiplyScalar(strength);
        this._eventOffsetTarget.add(this._tmp);
    }

    dolly(distance) {
        this._tmp.copy(this.focus).sub(this.camera.position).normalize().multiplyScalar(distance);
        this._eventOffsetTarget.add(this._tmp);
    }

    vertigo(strength = 1.0) {
        this.dolly(-0.3 * strength);
        this._eventFovDeltaTarget -= 4 * strength;
    }

    pullBack(distance = 1.5) {
        this._eventOffsetTarget.z += distance;
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
