/**
 * A touch of life on the glide from one orb to the next (OdysseyCameraController.updatePathTravel).
 *
 * The glide was a plain eased ride along the rail. It is seen after every orb, so it gets what a
 * ride has and a dolly does not:
 *   - the view BANKS into its own turn, the way anything that flies does: it rolls a few
 *     degrees toward the side the view is swinging to, and levels out as the swing ends;
 *   - it BREATHES: the lens widens a little as the ride gathers pace and closes again as it
 *     arrives (the controller's own FOV pulse, one smooth hump over the trip).
 * Neither moves the eye or its aim: the trip rides the rail's own frame, to the unit (the
 * controller's tests hold it there once the trip has eased out of the pose it started in; a
 * swoop of the eye was tried and broke exactly that). The bank follows an envelope that is zero
 * at the start and the end of the trip (value and slope) and the breath is a hump that ends on
 * the lens it started from, so the glide leaves and lands on the rail's framing: nothing here
 * can change a resting view, and the framing guards (which test resting views) are untouched.
 *
 * Not on the plunge through the black hole (that trip has its own roll and its own pace), not
 * on the opening sweep (a long flight that already has a profile), not under reduced motion.
 * Its only state rides on the trip itself, so a paused trip holds its pose and a new trip
 * starts level.
 */
import * as THREE from 'three/webgpu';

export const GLIDE_LIFE = Object.freeze({
    /** The most the view rolls into a turn (degrees). */
    bankDeg: 2.8,
    /** Degrees of roll per degree-a-second the view swings. */
    bankGain: 0.16,
    /** How quickly the roll follows the swing (per second). */
    bankFollow: 5,
    /** The breath: how much the lens widens at its fullest (degrees). */
    fovDeg: 3.2,
    /** Trips shorter than this (ms) are a settle, not a ride. */
    minDurationMs: 700,
});

/** 0 at both ends of the trip with zero slope, 1 at its middle. */
export function glideEnvelope(raw) {
    const t = Math.max(0, Math.min(1, raw));
    const s = Math.sin(Math.PI * t);
    return s * s;
}

/**
 * The roll the view is heading for (radians, as camera.rotateZ takes it: positive rolls the
 * camera counter-clockwise, a bank to the left) while it swings `swingDegPerSecond` to the left.
 */
export function glideBankTarget(swingDegPerSecond, raw) {
    const bank = THREE.MathUtils.clamp(
        swingDegPerSecond * GLIDE_LIFE.bankGain,
        -GLIDE_LIFE.bankDeg,
        GLIDE_LIFE.bankDeg,
    );
    return THREE.MathUtils.degToRad(bank) * glideEnvelope(raw);
}

const scratch = { look: new THREE.Vector3(), cross: new THREE.Vector3() };

/**
 * Whether this trip is a glide that takes the life: an orb-to-orb ride, long enough to read.
 * @param {object} travel OdysseyCameraController.pathTravel
 * @param {boolean} reducedMotion
 */
export function glideTakesLife(travel, reducedMotion) {
    return Boolean(travel?.active) && !reducedMotion && !travel.sweep && !travel.plunge
        && travel.duration >= GLIDE_LIFE.minDurationMs;
}

/**
 * Bank and breathe this frame of the trip. Call after the trip has placed the camera on the
 * rail (and eased it out of the pose it started in).
 * @param {object} controller OdysseyCameraController (camera, followCameraUp, lookAtTarget,
 *   prefersReducedMotion, triggerFovPulse, _pendingViewRoll)
 * @param {object} travel its pathTravel
 * @returns {boolean} whether anything was applied
 */
export function applyGlideLife(controller, travel) {
    if (!glideTakesLife(travel, controller.prefersReducedMotion?.() === true)) return false;
    const up = controller.followCameraUp;
    const { camera, lookAtTarget } = controller;
    if (!up || !camera || !lookAtTarget) return false;
    const raw = Math.min(travel.elapsed / travel.duration, 1);

    // The view's own swing this frame, signed about its up: positive is a swing to the left.
    const look = scratch.look.subVectors(lookAtTarget, camera.position);
    if (look.lengthSq() < 1e-10) return false;
    look.normalize();
    let life = travel.glideLife;
    if (!life) {
        life = { look: look.clone(), at: travel.elapsed, roll: 0 };
        travel.glideLife = life;
        // The breath: one hump over the whole trip, ending on the lens it began with. A chapter
        // arrival breathes on its own, longer clock (odyssey-arrival-move.js).
        if (!controller.arrivalMove) {
            controller.triggerFovPulse?.('expand', { amount: GLIDE_LIFE.fovDeg, duration: travel.duration / 1000 });
        }
    }
    const dt = (travel.elapsed - life.at) / 1000;
    if (dt > 0) {
        const turn = scratch.cross.crossVectors(life.look, look).dot(up);
        const swing = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(turn, -1, 1))) / dt;
        const target = glideBankTarget(swing, raw);
        life.roll += (target - life.roll) * (1 - Math.exp(-dt * GLIDE_LIFE.bankFollow));
        life.look.copy(look);
        life.at = travel.elapsed;
    }
    // The roll is held inside the envelope too, so it is level when the trip lands whatever
    // the last frames swung.
    const cap = THREE.MathUtils.degToRad(GLIDE_LIFE.bankDeg) * glideEnvelope(raw);
    life.roll = THREE.MathUtils.clamp(life.roll, -cap, cap);
    controller._pendingViewRoll = (controller._pendingViewRoll || 0) + life.roll;
    return true;
}
