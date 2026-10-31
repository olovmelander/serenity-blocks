// @ts-check
/**
 * The first redraws of a static shadow map (`shadow.autoUpdate = false`), counted as draws, not frames.
 *
 * A theme with a static map redraws it over its first frames, so a caster whose build or pipeline came
 * late still lands in it, then again at a few later marks. three draws a shadow map only in a frame
 * that draws something receiving it (ShadowNode.updateBefore runs from the receivers' render objects),
 * and clears `shadow.needsUpdate` once it has drawn. While an in-play switch's hidden build slices its
 * builds (three r187, "Sliced builds" in src/rendering/async-render-pipelines.js), the first frames
 * draw no receivers: a count of frames ran out with the map drawn once and most casters unbuilt.
 * Forest then built the other 17 casters and compiled 4 shadow pipelines at its frame-45 redraw, at
 * the reveal, and the first-visit switch's worst frame went 48 -> 79 ms (2026-10-31). Counted as draws,
 * the first redraws wait for the frames that draw. When every frame draws (no sliced build, r186), the
 * same frames redraw as before: frames 1-9 after a reset.
 */

/** How many times a static map is drawn before only its later marks redraw it. */
export const STATIC_SHADOW_FIRST_DRAWS = 9;

/**
 * Call once per frame, before the frame renders. Asks for a redraw while the map has had fewer than
 * its first draws, or when `alsoRedraw` (the caller's later marks).
 * Reset the count with `owner.shadowDraws = 0` wherever the frame count is reset.
 * @param {{ shadowDraws?: number, shadowPending?: boolean }} owner holds the map's counters
 * @param {{ needsUpdate: boolean } | null | undefined} shadow the light's LightShadow
 * @param {boolean} [alsoRedraw]
 */
export function redrawStaticShadow(owner, shadow, alsoRedraw = false) {
    if (!shadow) return;
    /* eslint-disable no-param-reassign -- the counters live on the light that owns the map */
    // Asked for at the end of the last call and cleared since: three drew it.
    if (owner.shadowPending === true && shadow.needsUpdate === false) owner.shadowDraws = (owner.shadowDraws ?? 0) + 1;
    if ((owner.shadowDraws ?? 0) < STATIC_SHADOW_FIRST_DRAWS || alsoRedraw) shadow.needsUpdate = true;
    owner.shadowPending = shadow.needsUpdate === true;
    /* eslint-enable no-param-reassign */
}
