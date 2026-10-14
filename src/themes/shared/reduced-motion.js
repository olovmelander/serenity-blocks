// @ts-check

/**
 * The player's reduced-motion choice for themes: Settings > Reduce motion or the system
 * preference, read live, and an eased 0..1 motion factor that follows it.
 *
 * camera-breath.js re-exports both; a theme that keeps its own breath (wolfhour) imports them
 * from here.
 */

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

/**
 * How much of a theme's motion to show: 1 = all of it, 0 = held still for reduced motion.
 * It follows prefersReducedMotion() over `seconds`, eased at both ends, so a camera eases into
 * or out of its rest pose instead of jumping when the setting flips. The first call settles at
 * once (a theme built under reduced motion starts still). Keep `state` on the theme or world.
 * @param {{ ramp?: number | null }} state
 * @param {number} dt seconds since the last call
 * @param {number} [seconds]
 * @returns {number}
 */
export function easedMotion(state, dt, seconds = 1.5) {
    const target = prefersReducedMotion() ? 0 : 1;
    if (typeof state.ramp !== 'number') state.ramp = target;
    const step = Math.max(0, Number.isFinite(dt) ? dt : 0) / seconds;
    state.ramp += Math.max(-step, Math.min(step, target - state.ramp));
    const r = state.ramp;
    return r * r * (3 - 2 * r);
}
