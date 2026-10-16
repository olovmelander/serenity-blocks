/**
 * A world's build as steps: the same work, in the same order, drawing from the same random
 * sequence, with a breath between steps so the page gets its frames.
 *
 * A theme's world built every part in one synchronous call: 0.3-0.5 s of main thread in one task
 * (verdant, summer: grass scattered over the terrain, the land, the tree layouts). Switched in
 * during play, that task froze the theme still playing; from the menu, the loading screen. A world
 * written as a generator (`*buildSteps()`, yielding between its parts) can be run either way:
 * `drainSteps` at once (its `build()`, the tests), `runStepsBreathing` with a macrotask between
 * steps while the theme comes in.
 *
 * The breath is a timeout, not a frame: a page drawn in software (the theme validator) can take a
 * second a frame, and a build that waited for frames would outlast its start timeout.
 */

/** One macrotask: whatever the page has queued (a frame of the theme still playing) runs first. */
export const breathe = () => new Promise((resolve) => { setTimeout(resolve, 0); });

/** Run every step now; returns what the generator returns. */
export function drainSteps(steps) {
    let next = steps.next();
    while (!next.done) next = steps.next();
    return next.value;
}

/**
 * Run the steps with a breath after each. Resolves true when all of them ran, false as soon as
 * `isCurrent()` turns false after a breath (the rest is not run: the caller disposes what was made).
 * @param {Generator} steps
 * @param {() => boolean} [isCurrent]
 * @param {() => Promise<void>} [pause]
 */
export async function runStepsBreathing(steps, isCurrent = () => true, pause = breathe) {
    let next = steps.next();
    while (!next.done) {
        // eslint-disable-next-line no-await-in-loop
        await pause();
        if (!isCurrent()) return false;
        next = steps.next();
    }
    return true;
}
