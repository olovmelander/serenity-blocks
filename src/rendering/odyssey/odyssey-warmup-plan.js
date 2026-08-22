/**
 * @fileoverview Pure sample-list builder for the journey warm-up replay.
 *
 * WebGPU pipelines specialize per MATERIAL + PASS TARGET, not per camera position, so
 * the old 40-evenly-spaced warm-up samples were ~75% redundant. The minimal set that
 * still pays every first-visit cost before the user can move:
 *   • one interior sample per chapter span — renders that chapter's materials through
 *     the post PassNode target with its real visibility/blend state;
 *   • one sample AT each internal chapter boundary — the seam co-presence state (both
 *     chapters visible, ecotone overlap, breach veil/ring/particles, threshold seam
 *     phase, crossfade light state) that compileAsync can never cover;
 *   • the journey ends 0 and 1.
 * ≈17 renderFrame calls instead of ~64. If a specific seam ever regresses (a hitch on
 * first crossing), widen ONLY that boundary back to a ±0.02 triplet — do not restore
 * the even sweep.
 *
 * Pure module (no THREE imports) so it unit-tests without a GPU.
 */

/**
 * Build the sorted, deduplicated, clamped warm-up sample list.
 * @param {{chapterPositions?: number[]}} options chapter boundary positions (0..1);
 *   entries at/near 0 and 1 are treated as journey ends, interior entries as seams.
 * @returns {number[]} progress samples in [0, 1], ascending
 */
export function buildJourneyWarmSamples({ chapterPositions = [] } = {}) {
    const samples = new Set([0, 1]);

    const internal = chapterPositions
        .filter((b) => Number.isFinite(b) && b > 0.001 && b < 0.999)
        .sort((a, b) => a - b);

    // Seam co-presence: one sample exactly at each internal boundary.
    internal.forEach((b) => samples.add(b));

    // One interior midpoint per chapter span (spans run between consecutive stops,
    // including the 0 and 1 journey ends).
    const stops = [0, ...internal, 1];
    for (let i = 0; i < stops.length - 1; i += 1) {
        samples.add((stops[i] + stops[i + 1]) / 2);
    }

    return [...samples]
        .map((s) => Math.min(1, Math.max(0, s)))
        .sort((a, b) => a - b);
}

/**
 * Build a sorted sample list for a restricted chapter window.
 * Used by capture sessions that intentionally load only one chapter plus neighbors
 * to avoid compiling the whole journey on weaker GPUs.
 * @param {{chapterPositions?: number[], chapterIds?: number[]}} options
 * @returns {number[]} progress samples in [0, 1], ascending
 */
export function buildChapterWarmSamples({ chapterPositions = [], chapterIds = [] } = {}) {
    const samples = new Set();
    const chapterCount = Math.max(0, chapterPositions.length - 1);
    const ids = [...new Set(
        chapterIds
            .map((id) => Number.parseInt(id, 10))
            .filter((id) => Number.isInteger(id) && id >= 1 && id <= chapterCount),
    )].sort((a, b) => a - b);

    ids.forEach((chapterId) => {
        const start = chapterPositions[chapterId - 1];
        const end = chapterPositions[chapterId] ?? 1;
        if (!Number.isFinite(start) || !Number.isFinite(end)) return;
        samples.add(start);
        samples.add((start + end) / 2);
        samples.add(end);
    });

    return [...samples]
        .map((s) => Math.min(1, Math.max(0, s)))
        .sort((a, b) => a - b);
}

export function buildPointWarmSamples({ position = 0 } = {}) {
    const value = Number(position);
    if (!Number.isFinite(value)) return [0];
    return [Math.min(1, Math.max(0, value))];
}

/**
 * Early-journey positions whose FIRST VISIBLE FRAME was measured landing mid-traverse as a
 * hitch under fast-start's single p=0 warm sample (audit 2026-08-17, masterplan F1): the steam
 * quench reveals at p≈0.005, Earth Core's lava fall + splash at p≈0.031, the ENTIRE One World
 * group at its act gate p≈0.043, the threshold/breach director across the 1→2 seam
 * (p≈0.043-0.087), and the forest chunk uploads at p≈0.185-0.20. The values below bracket each
 * of those (a sample slightly PAST a reveal threshold is what forces its first real render);
 * the in-between points keep the scrub from skipping any other progress-gated state.
 */
export const ODYSSEY_MOTION_WARM_SAMPLES = Object.freeze([
    0, 0.006, 0.016, 0.032, 0.045, 0.056, 0.07, 0.09, 0.125, 0.16, 0.19, 0.21,
]);

/**
 * Build the MOTION warm sample list for fast-start: a short scrub through the stretch ahead of
 * the reveal position, so motion-triggered first-visible-frame costs are paid behind the
 * loading overlay instead of on a live frame. A static point sample cannot cover these — that
 * is the measured lesson fast-start originally shipped without.
 *
 * Fresh/early starts (the overwhelmingly common case) use the authored early-journey list
 * above. A resume deeper into the journey warms a short RELATIVE sweep ahead of the player
 * instead — the authored points are absolute path features and are far behind by then.
 *
 * @param {{position?: number, aheadWindow?: number}} options reveal position; how far ahead a
 *   deep-resume sweep reaches (defaults to the authored window's span).
 * @returns {number[]} ascending samples in [0, 1], starting at the reveal position
 */
export function buildMotionWarmSamples({ position = 0, aheadWindow = 0.21 } = {}) {
    const p = Number.isFinite(Number(position)) ? Math.min(1, Math.max(0, Number(position))) : 0;
    const window = Number.isFinite(Number(aheadWindow)) && Number(aheadWindow) > 0
        ? Number(aheadWindow)
        : 0.21;

    const samples = new Set([p]);
    if (p <= 0.05) {
        // Early start: the authored reveal list, from the reveal position onward.
        ODYSSEY_MOTION_WARM_SAMPLES.forEach((s) => { if (s >= p) samples.add(s); });
    } else {
        // Deep resume: a short relative sweep ahead of the player.
        [0.015, 0.04, 0.08, 0.14, window].forEach((d) => samples.add(Math.min(1, p + d)));
    }
    return [...samples].sort((a, b) => a - b);
}

/**
 * Build the chapter visit order for the POST-REVEAL background render-warm sweep.
 *
 * Two rules, both learned from a measured failure (2026-08-17):
 *
 * 1. SUPPRESSED CHAPTERS MUST NEVER ENTER THE SWEEP. Under One World (the default) chapters
 *    2-5 are suppressed — the single continuous world owns that stretch — so their environments
 *    are never created. An unfiltered `1..total` sweep therefore sat in its "not created yet"
 *    wait for 30 x 300ms = 9s on EACH of them, ~36s of dead time, before it even considered
 *    chapters 6-8 — the ones the player actually scrolls into. The sweep never completed, so
 *    fast-start (which reveals early and repays the skipped warm-up in the background) never
 *    repaid, and every forward transition paid its first-visit compile on a visible frame.
 *
 * 2. NEAREST THE PLAYER FIRST, so the sweep warms what is about to be reached.
 *
 * @param {{total?: number, focus?: number, suppressed?: Iterable<number>}} options
 *   total — highest chapter id in the journey; focus — the player's current chapter;
 *   suppressed — chapter ids the configuration will never create.
 * @returns {number[]} chapter ids to warm, nearest-to-focus first
 */
export function buildRenderWarmOrder({ total = 0, focus = 1, suppressed = [] } = {}) {
    const count = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
    const skip = suppressed instanceof Set ? suppressed : new Set(suppressed || []);
    const centre = Number.isFinite(focus) ? focus : 1;

    const order = [];
    for (let ch = 1; ch <= count; ch += 1) {
        if (!skip.has(ch)) order.push(ch);
    }
    // Stable nearest-first: ties (equidistant either side) keep ascending chapter order.
    return order.sort((a, b) => (Math.abs(a - centre) - Math.abs(b - centre)) || (a - b));
}

export default {
    buildJourneyWarmSamples,
    buildChapterWarmSamples,
    buildPointWarmSamples,
    buildRenderWarmOrder,
};
