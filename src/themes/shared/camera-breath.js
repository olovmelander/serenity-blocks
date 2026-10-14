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
 * Deliberately imports nothing, like camera-rig.js: it only needs `camera.fov`,
 * `translateX/Y/Z` and `rotateX/Y`, which both three builds provide.
 */

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
 * @returns {{x:number,y:number,z:number}} x right and y up as fractions of viewport
 *   height; z the lean toward the subject as a fraction of the distance to it
 */
export function cameraBreath(time, scale = 1, out = { x: 0, y: 0, z: 0 }) {
    const k = Number.isFinite(scale) ? Math.max(0, scale) : 0;
    const t = Number.isFinite(time) ? time : 0;
    if (k === 0) {
        out.x = 0;
        out.y = 0;
        out.z = 0;
        return out;
    }
    const fill = breathFill(t);
    out.x = k * CAMERA_BREATH.WANDER_X * Math.sin((t / CAMERA_BREATH.WANDER_X_PERIOD) * TAU);
    out.y = k * (CAMERA_BREATH.LIFT * fill
        + CAMERA_BREATH.WANDER_Y * Math.sin((t / CAMERA_BREATH.WANDER_Y_PERIOD) * TAU));
    out.z = k * CAMERA_BREATH.LEAN * fill;
    return out;
}

/** @type {MediaQueryList | null} */
let reduceQuery = null;
/** The window `reduceQuery` belongs to (tests swap it). */
let reduceQueryWindow = null;

/**
 * The player's reduced-motion choice: Settings > Reduce motion, or the system preference.
 * For themes that keep no reduced-motion state of their own; cheap enough to call every
 * frame (the media query is created once).
 * @returns {boolean}
 */
export function prefersReducedMotion() {
    if (typeof window === 'undefined') return false;
    if (/** @type {any} */ (window).settings?.reducedMotion === true) return true;
    if (reduceQueryWindow !== window) {
        reduceQueryWindow = window;
        reduceQuery = typeof window.matchMedia === 'function'
            ? window.matchMedia('(prefers-reduced-motion: reduce)')
            : null;
    }
    return reduceQuery?.matches === true;
}

const _breath = { x: 0, y: 0, z: 0 };

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
    const b = cameraBreath(time, scale, _breath);
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
