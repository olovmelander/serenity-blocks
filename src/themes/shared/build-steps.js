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

/**
 * A long loop's clock inside a build written as steps: `due()` once `budgetMs` of work has run
 * since the loop started or last breathed, and the loop yields there and `restart()`s it. Each
 * breath costs the theme still playing a frame, so the steps are few and full.
 * @param {number} [budgetMs]
 */
export function stepClock(budgetMs = 24) {
    let since = performance.now();
    return {
        due: () => performance.now() - since > budgetMs,
        restart() { since = performance.now(); },
    };
}

/** One macrotask: whatever the page has queued (a frame of the theme still playing) runs first. */
export const breathe = () => new Promise((resolve) => { setTimeout(resolve, 0); });

/** Run every step now; returns what the generator returns. */
export function drainSteps(steps) {
    let next = steps.next();
    while (!next.done) next = steps.next();
    return next.value;
}

/**
 * Run the steps with a breath before each, the first included: the build never shares a task with
 * what came before it (the world's constructor, the renderer's setup). Resolves true when all of
 * them ran, false as soon as `isCurrent()` turns false after a breath (the rest is not run: the
 * caller disposes what was made, which may be nothing).
 * @param {Generator} steps
 * @param {() => boolean} [isCurrent]
 * @param {() => Promise<void>} [pause]
 */
export async function runStepsBreathing(steps, isCurrent = () => true, pause = breathe) {
    for (;;) {
        // eslint-disable-next-line no-await-in-loop
        await pause();
        if (!isCurrent()) return false;
        if (steps.next().done) return true;
    }
}

/**
 * Upload a built world's big textures one to a breath (`renderer.initTexture`), before its first
 * frame. three uploads a texture when the first draw binds it, so a world's first frame uploaded
 * them all at once: High Coast's three fields (~18 MB of half floats) held the GPU process ~50 ms in
 * one frame of a first visit (2026-10-31). Uploaded earlier, the same data, so the same pictures.
 * Resolves false as soon as `isCurrent()` turns false after a breath; a texture that fails here is
 * left to the first draw, as before.
 * @param {any} renderer
 * @param {ReadonlyArray<any>} textures
 * @param {() => boolean} [isCurrent]
 * @param {() => Promise<void>} [pause]
 * @returns {Promise<boolean>}
 */
export async function uploadTexturesBreathing(renderer, textures, isCurrent = () => true, pause = breathe) {
    if (typeof renderer?.initTexture !== 'function') return true;
    for (let i = 0; i < textures.length; i++) {
        // eslint-disable-next-line no-await-in-loop
        await pause();
        if (!isCurrent()) return false;
        try {
            if (textures[i]?.isTexture === true) renderer.initTexture(textures[i]);
        } catch {
            // The first draw uploads it.
        }
    }
    return true;
}

/**
 * Build a world (its `buildSteps()` breathing, or its `build()` at once) and hand it over only when
 * it is whole. Between the breaths the theme has no world: a resume, a resize or a setting changed
 * meanwhile finds none, as during any other wait of a start, never a half-built one. A start
 * stopped meanwhile, or a build that throws half-way, disposes the world here.
 * @param {{ build: () => unknown, buildSteps?: () => Generator, dispose?: () => void }} world
 * @param {() => boolean} [isCurrent]
 * @param {() => Promise<void>} [pause]
 * @returns {Promise<boolean>} true when built: the caller owns the world from here
 */
export async function buildWorldBreathing(world, isCurrent = () => true, pause = breathe) {
    try {
        if (typeof world.buildSteps !== 'function') {
            world.build();
            return true;
        }
        if (await runStepsBreathing(world.buildSteps(), isCurrent, pause)) return true;
    } catch (error) {
        world.dispose?.();
        throw error;
    }
    world.dispose?.();
    return false;
}
