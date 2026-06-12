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

export default { buildJourneyWarmSamples };
