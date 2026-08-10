// @ts-check
/**
 * Frame pacing for theme render loops.
 *
 * Every theme drives its own requestAnimationFrame loop, so on a high-refresh
 * display it renders a full 3D scene once per vsync — 240 renders/second on a
 * 240Hz panel — regardless of the player's "Target Frame Rate" setting. The
 * setting caps nothing: `FrameRateController.shouldProcessFrame()` has no call
 * sites outside its own file, and the standard single-player loop never
 * consults it. See docs/GAMEPLAY_SMOOTHNESS_INVESTIGATION_2026-08.md §5b.
 *
 * The cost is real: a 60Hz simulation was paying 4x the necessary GPU work,
 * which is precisely why there was no headroom left to absorb a pipeline-compile
 * stall. Raising the frame rate was what prevented the frame rate from being
 * stable.
 *
 * This module is pure and renderer-free so the pacing rule can be tested
 * directly. The rule has one job beyond "don't render too often": it must never
 * push the effective rate *below* the target. Naively gating on
 * `elapsed >= 1000 / targetFps` does exactly that whenever the display cadence
 * does not divide evenly into the target — a 90Hz cadence against a 60fps
 * target would render every second frame and yield 45fps.
 *
 * The fix is a tolerance of half the observed frame interval: if waiting for the
 * next frame would overshoot the target by more than half a frame, render now
 * instead. That produces the right answer at every cadence:
 *
 *   240Hz cadence, 60fps target -> every 4th frame = 60fps  (caps, saves 75%)
 *   144Hz cadence, 60fps target -> every 2nd frame = 72fps  (caps, saves 50%)
 *    90Hz cadence, 60fps target -> every frame     = 90fps  (declines to cap)
 *    60Hz cadence, 60fps target -> every frame     = 60fps  (no-op)
 *   240Hz cadence, 30fps target -> every 8th frame = 30fps
 *
 * Because the tolerance tracks the *observed* cadence rather than a declared
 * refresh rate, a GPU-bound loop whose rAF has already slowed below the target
 * stops being gated automatically, with no oscillation and no dependence on
 * display metadata being correct.
 */

/** Two calls closer together than this are treated as the same frame. */
const SAME_FRAME_EPSILON_MS = 1;

/** Smoothing for the observed frame-interval estimate. */
const INTERVAL_EMA_ALPHA = 0.2;

/**
 * Slack when comparing the look-ahead against the deadline, so a frame landing
 * exactly on the interval (240Hz into 60fps) is treated as reachable rather
 * than being rendered one frame early by float noise.
 */
const DEADLINE_EPSILON_MS = 0.5;

/**
 * @typedef {Object} FramePacerState
 * @property {boolean} started
 * @property {number} lastCallAt      timestamp of the previous decision
 * @property {boolean} lastDecision   so repeat calls in one frame agree
 * @property {number} lastRenderAt    timestamp of the last allowed render
 * @property {number} intervalEma     smoothed ms between calls (0 until known)
 */

/** @returns {FramePacerState} */
export function createFramePacer() {
    return {
        started: false,
        lastCallAt: 0,
        lastDecision: true,
        lastRenderAt: 0,
        intervalEma: 0,
    };
}

/** Forget the cadence estimate — call when a loop restarts after a gap. */
export function resetFramePacer(state) {
    if (!state) return;
    state.started = false;
    state.lastCallAt = 0;
    state.lastDecision = true;
    state.lastRenderAt = 0;
    state.intervalEma = 0;
}

/**
 * Decide whether the theme should render this frame.
 *
 * Call exactly once per animation frame. Repeat calls within the same frame
 * return the same answer and do not disturb the cadence estimate, so a theme
 * that consults this twice cannot accidentally skip its own render.
 *
 * @param {FramePacerState} state mutable pacer state
 * @param {number} now `performance.now()`-style timestamp in ms
 * @param {number} targetFps player's cap; 0 / non-finite means unlimited
 * @returns {boolean} true when this frame should render
 */
export function shouldRenderAtTargetFps(state, now, targetFps) {
    if (!state) return true;

    const target = Number(targetFps);
    if (!Number.isFinite(target) || target <= 0) {
        // Unlimited: keep the cadence estimate fresh so re-enabling the cap
        // does not have to relearn it, but never gate.
        observeCall(state, now);
        state.lastRenderAt = now;
        state.lastDecision = true;
        return true;
    }

    if (state.started && (now - state.lastCallAt) < SAME_FRAME_EPSILON_MS) {
        return state.lastDecision;
    }

    observeCall(state, now);

    if (state.lastRenderAt === 0) {
        state.lastRenderAt = now;
        state.lastDecision = true;
        return true;
    }

    const interval = 1000 / target;
    const elapsed = now - state.lastRenderAt;
    // Look one frame ahead: skip only when the NEXT frame would still land
    // inside the target interval. If waiting would overshoot the deadline, this
    // frame is the closest we can get, so render now. That is what keeps the
    // effective rate at or above the target on cadences that do not divide
    // evenly (165Hz/60 renders every 2nd frame = 82.5fps, not every 3rd = 55fps),
    // and what makes the cap decline to fire once the cadence has fallen to the
    // target on its own. Before the cadence is known, degrade to a plain gate.
    const lookahead = state.intervalEma > 0 ? state.intervalEma : 0;

    if ((elapsed + lookahead) <= (interval + DEADLINE_EPSILON_MS)) {
        state.lastDecision = false;
        return false;
    }

    state.lastRenderAt = now;
    state.lastDecision = true;
    return true;
}

/**
 * Fold this call into the observed-cadence estimate.
 * @param {FramePacerState} state
 * @param {number} now
 */
function observeCall(state, now) {
    if (state.started) {
        const delta = now - state.lastCallAt;
        // Ignore nonsense (clock jumps, tab restore) so one bad sample cannot
        // poison the tolerance for the next several seconds.
        if (delta > 0 && delta < 250) {
            state.intervalEma = state.intervalEma > 0
                ? (state.intervalEma * (1 - INTERVAL_EMA_ALPHA)) + (delta * INTERVAL_EMA_ALPHA)
                : delta;
        }
    }
    state.started = true;
    state.lastCallAt = now;
}

/**
 * Read the player's target frame rate from the live settings object.
 * Returns 0 (unlimited) when unavailable or explicitly uncapped.
 * @param {*} [win] injectable for tests
 * @returns {number}
 */
export function resolveTargetFps(win = typeof window !== 'undefined' ? window : null) {
    const raw = win?.serenityBlocks?.settingsManager?.get?.()?.targetFrameRate;
    const fps = Number(raw);
    if (!Number.isFinite(fps) || fps <= 0) return 0;
    // Guard against a corrupt setting stalling every theme to a slideshow.
    return Math.max(30, fps);
}
