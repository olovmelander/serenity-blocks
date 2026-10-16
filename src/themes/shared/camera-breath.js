// @ts-check

/**
 * Shared camera breath — the slow rise-and-settle every theme's camera carries at rest.
 *
 * A theme is a backdrop the player looks at for an hour. A camera that never moves turns
 * it into a still image; one that drifts on a period of minutes reads as still too, since
 * nobody watches long enough to see it. The breath is the motion every theme shares,
 * layered on whatever pose the theme already chose this frame:
 *
 *   - the breath itself: on the in-breath the view lifts a little and leans in toward its
 *     subject; on the out-breath it settles back to the theme's own framing. One cycle is
 *     4 s in and 6 s out, six breaths a minute, the calm rate the breathing guide teaches.
 *   - a slow wander across and up, on periods that share no factor with the breath or
 *     with each other, so the motion never visibly loops.
 *
 * ── Units: screen fractions, as in camera-rig.js ───────────────────────────────────
 * Themes frame their subjects from 15 units away and from 1200, so an amount in world
 * units means nothing. The lift and the wander are fractions of viewport HEIGHT at the
 * subject; the lean-in is a fraction of the distance to the subject (so about the
 * fraction the subject grows). The same numbers look the same in every theme.
 *
 * ── How it composes ─────────────────────────────────────────────────────────────────
 * applyCameraBreath() moves the camera in its OWN frame (right, up, forward) and turns it
 * back toward the subject with local rotations, so the subject holds its place on screen
 * while nearer and farther layers slide past it — and whatever roll or bank the theme set
 * is kept. Without a subject distance it only turns the view (a sky has no near layer to
 * slide). Either way it writes on top of this frame's pose, so the theme must set the
 * pose every frame before calling it (a theme with a fixed camera restores its rest pose
 * first) and call it before anything reads the camera back (uniforms, screen projections).
 *
 * A pure function of time: pass the theme's own clock (the one its captures seek), so a
 * seeked or fixed-time capture lands on the same pose every run. At time 0 every term is
 * zero, so a theme's rest pose is untouched there. Reduced motion: pass scale 0, which
 * leaves the camera exactly as the theme set it.
 *
 * Imports no three.js, like camera-rig.js: it only needs `camera.fov`, `translateX/Y/Z` and
 * `rotateX/Y`, which both three builds provide.
 *
 * ── Breathing with the player ───────────────────────────────────────────────────────
 * When the breathing guide leads a breath over the theme it publishes the lungs' fill
 * (src/core/breath-signal.js). applyCameraBreath() then follows that breath instead of the
 * clock's: the lift and the lean become a little larger so the breath can be followed, and
 * the wander quietens, so a hold is still. It eases from the clock's breath to the guide's
 * over FOLLOW_SECONDS of the theme's clock and back when the guide ends. cameraBreath() stays
 * a pure function: the followed breath is passed to it.
 */

import { readBreathSignal } from '../../core/breath-signal.js';

const TAU = Math.PI * 2;
const DEG2RAD = Math.PI / 180;

// Sized to be seen without being watched: the lift peaks near 3 px/s at 1080p and the
// wander near 2 px/s. The theme drifts these layer onto mostly run on 50-370 s periods
// at well under 1 px/s, which is below what anyone notices on a backdrop.
export const CAMERA_BREATH = Object.freeze({
    INHALE: 4, // seconds
    EXHALE: 6,
    LIFT: 0.008, // fraction of viewport height, at full lungs
    LEAN: 0.015, // fraction of the distance to the subject, at full lungs
    WANDER_X: 0.009, // fraction of viewport height, either way
    WANDER_X_PERIOD: 31, // seconds
    WANDER_Y: 0.004,
    WANDER_Y_PERIOD: 47,
    // Following a guided breath: the lift and lean grow by this much, the wander shrinks to
    // this share, and the change between the clock's breath and the guide's takes this long.
    GUIDED_GAIN: 1.75,
    GUIDED_WANDER: 0.35,
    FOLLOW_SECONDS: 2,
});

const BREATH_PERIOD = CAMERA_BREATH.INHALE + CAMERA_BREATH.EXHALE;

/**
 * How full the lungs are at `time`: 0 at rest, 1 at the top of the in-breath. Eased at
 * both turns (zero velocity), so the camera never jerks where the breath changes way.
 * @param {number} time seconds
 * @returns {number} in [0, 1]
 */
export function breathFill(time) {
    const t = Number.isFinite(time) ? time : 0;
    const phase = ((t % BREATH_PERIOD) + BREATH_PERIOD) % BREATH_PERIOD;
    if (phase < CAMERA_BREATH.INHALE) {
        return 0.5 - 0.5 * Math.cos((Math.PI * phase) / CAMERA_BREATH.INHALE);
    }
    return 0.5 + 0.5 * Math.cos((Math.PI * (phase - CAMERA_BREATH.INHALE)) / CAMERA_BREATH.EXHALE);
}

/**
 * The breath at `time`, in screen units.
 * @param {number} time seconds on the theme's clock
 * @param {number} [scale] multiplier on every amount; 0 for reduced motion
 * @param {{x:number,y:number,z:number}} [out] reused result object
 * @param {{fill:number, weight:number}|null} [follow] a guided breath to follow: its fill
 *   (0..1) and how far the camera has moved over to it (0 = the clock's breath, 1 = the guide's)
 * @returns {{x:number,y:number,z:number}} x right and y up as fractions of viewport
 *   height; z the lean toward the subject as a fraction of the distance to it
 */
export function cameraBreath(time, scale = 1, out = { x: 0, y: 0, z: 0 }, follow = null) {
    const k = Number.isFinite(scale) ? Math.max(0, scale) : 0;
    const t = Number.isFinite(time) ? time : 0;
    if (k === 0) {
        out.x = 0;
        out.y = 0;
        out.z = 0;
        return out;
    }
    const clockFill = breathFill(t);
    const w = follow && Number.isFinite(follow.weight) ? Math.min(1, Math.max(0, follow.weight)) : 0;
    const guided = follow && w > 0 && Number.isFinite(follow.fill) ? Math.min(1, Math.max(0, follow.fill)) : clockFill;
    const fill = clockFill + (guided - clockFill) * w;
    const gain = 1 + (CAMERA_BREATH.GUIDED_GAIN - 1) * w;
    const wander = 1 - (1 - CAMERA_BREATH.GUIDED_WANDER) * w;
    out.x = k * wander * CAMERA_BREATH.WANDER_X * Math.sin((t / CAMERA_BREATH.WANDER_X_PERIOD) * TAU);
    out.y = k * (gain * CAMERA_BREATH.LIFT * fill
        + wander * CAMERA_BREATH.WANDER_Y * Math.sin((t / CAMERA_BREATH.WANDER_Y_PERIOD) * TAU));
    out.z = k * gain * CAMERA_BREATH.LEAN * fill;
    return out;
}

export { easedMotion, prefersReducedMotion } from './reduced-motion.js';

const _breath = { x: 0, y: 0, z: 0 };

/** Seconds the breath takes to come back when Reduce motion is switched off. */
const SCALE_FLIP_SECONDS = 1.5;
/** Per camera: the scale applied, easing toward the one asked for. A new camera starts settled. */
const scaleEase = new WeakMap();

function easedValue(state) {
    const p = state.progress;
    return state.from + (state.to - state.from) * p * p * (3 - 2 * p);
}

/**
 * The breath scale to apply this frame. Themes ask for 0 or 1 when Reduce motion flips. Switched
 * on, the breath stops at once (stillness was asked for); switched off, it used to restart in one
 * frame (a camera hop of about 2 units) and now eases back over SCALE_FLIP_SECONDS of the theme's
 * own clock. A scale that already moves smoothly (a theme that eases its own motion) is followed.
 */
function breathScale(camera, time, requested) {
    const target = Number.isFinite(requested) ? Math.max(0, requested) : 1;
    let state = scaleEase.get(camera);
    if (!state) {
        state = {
            from: target, to: target, progress: 1, time,
        };
        scaleEase.set(camera, state);
        return target;
    }
    // A clock that stood still, went back or jumped (a frozen frame, a seek, a capture, a replay)
    // lands settled: the same time and scale must give the same pose whatever came before. Only
    // time that is being played eases.
    const continuous = Number.isFinite(time) && Number.isFinite(state.time)
        && time > state.time && time - state.time <= 0.25;
    if (!continuous) {
        state.time = time;
        state.from = target;
        state.to = target;
        state.progress = 1;
        return target;
    }
    const dt = time - state.time;
    state.time = time;
    if (target < easedValue(state) - 1e-9) {
        // Less motion (Reduce motion switched on): at once. Asked for stillness, the camera
        // stops on the next frame; only the breath coming back eases in.
        state.from = target;
        state.to = target;
        state.progress = 1;
        return target;
    }
    if (Math.abs(target - state.to) > 0.25) {
        state.from = easedValue(state);
        state.to = target;
        state.progress = 0;
    } else if (state.progress >= 1) {
        state.from = target;
        state.to = target;
    } else {
        state.to = target;
    }
    state.progress = Math.min(1, state.progress + dt / SCALE_FLIP_SECONDS);
    return easedValue(state);
}

/** Per camera: how far it has moved over to a guided breath, and the last fill it followed. */
const followEase = new WeakMap();
const _follow = { fill: 0, weight: 0 };

/**
 * The guided breath this camera follows this frame, or null when it keeps the clock's. The
 * weight eases toward 1 while the guide publishes a breath and back to 0 when it stops, over
 * FOLLOW_SECONDS of the theme's clock; a clock that stands still holds it, and one that jumps
 * or goes back lands settled (as breathScale does).
 */
function followedBreath(camera, time) {
    const signal = readBreathSignal();
    const target = signal === null ? 0 : 1;
    let state = followEase.get(camera);
    if (!state) {
        if (target === 0) return null;
        state = { weight: 0, fill: signal, time };
        followEase.set(camera, state);
    }
    if (signal !== null) state.fill = signal;
    const finite = Number.isFinite(time) && Number.isFinite(state.time);
    const dt = finite ? time - state.time : Infinity;
    if (!(dt >= 0 && dt <= 0.25)) {
        state.weight = target;
    } else if (dt > 0) {
        const step = dt / CAMERA_BREATH.FOLLOW_SECONDS;
        state.weight += Math.max(-step, Math.min(step, target - state.weight));
    }
    state.time = time;
    if (state.weight <= 0) {
        // Back on the clock's breath: forget the camera once the guide has gone.
        if (target === 0) followEase.delete(camera);
        return null;
    }
    const w = state.weight;
    _follow.weight = w * w * (3 - 2 * w);
    _follow.fill = state.fill;
    return _follow;
}

/**
 * Layer the breath onto the pose the camera holds this frame.
 *
 * @param {any} camera a THREE.PerspectiveCamera (either three build), posed this frame
 * @param {number} time seconds on the theme's clock
 * @param {object} [options]
 * @param {number} [options.distance] distance from the camera to the subject it frames,
 *   in world units. Given, the camera moves and turns back toward the subject (layers
 *   slide past one another). Omitted or not finite, the view only turns.
 * @param {number} [options.scale] multiplier on every amount; 0 for reduced motion
 * @returns {boolean} whether the camera was moved
 */
export function applyCameraBreath(camera, time, options = {}) {
    if (!camera || typeof camera.rotateX !== 'function' || typeof camera.rotateY !== 'function') return false;
    const { distance, scale = 1 } = options;
    const b = cameraBreath(time, breathScale(camera, time, scale), _breath, followedBreath(camera, time));
    if (b.x === 0 && b.y === 0 && b.z === 0) return false;

    // Viewport height at one unit of distance: the screen fraction → world conversion.
    const fov = Number.isFinite(camera.fov) && camera.fov > 0 ? camera.fov : 50;
    const span = 2 * Math.tan((fov * DEG2RAD) / 2);
    const turnX = Math.atan(b.x * span);
    const turnY = Math.atan(b.y * span);

    if (Number.isFinite(distance) && distance > 0) {
        // Move along the camera's own axes, then turn back so the subject (`distance`
        // ahead) holds its place on screen. The turn is the same angle whatever the
        // distance, which is what keeps the motion the same size in every theme.
        const d = /** @type {number} */ (distance);
        const lean = b.z * d;
        camera.translateX(b.x * span * d);
        camera.translateY(b.y * span * d);
        camera.translateZ(-lean);
        const ahead = Math.max(d - lean, d * 0.5);
        camera.rotateY(Math.atan((b.x * span * d) / ahead));
        camera.rotateX(-Math.atan((b.y * span * d) / ahead));
        return true;
    }

    // No subject to orbit: turn the view through the same angles. Infinitely distant
    // layers then move exactly as they do above.
    camera.rotateY(turnX);
    camera.rotateX(-turnY);
    return true;
}
