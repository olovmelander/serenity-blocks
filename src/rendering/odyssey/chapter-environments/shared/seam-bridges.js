/**
 * @fileoverview Shared per-seam colour "bridge" constants (masterplan E3 — one source of truth).
 *
 * The 3→4 (alpine) and 5→6 (aurora) seams drive their sky/fog/ambient COLOUR lerp over a WIDER,
 * smootherstep'd window centred on the boundary — WITHOUT widening the ecotone/content seam (so no
 * extra double-render cost; only the per-frame colour scalar changes). Each lerp passes through a
 * midpoint "bridge" tone so the change reads as a smooth handoff, not a snap:
 *   • 3→4 alpine bridge — a cool alpine haze so Surface World eases into Mountains.
 *   • 5→6 aurora bridge — a deep teal aurora so Space inherits Sky-Drift's best ending tone
 *     (a deep teal aurora bridge, not lavender haze).
 *
 * These were copy-pasted identically in both ChapterEnvironmentManager.js and
 * composition/OdysseyDirector.js (live drift risk); they now live here and both import them.
 * `*_COLOUR_HALF_WIDTH` is the per-side progress window for each boundary's colour/fog lerp.
 */

export const SEAM_34_COLOUR_HALF_WIDTH = 0.055;
// SEAM_34_ALPINE_BRIDGE is DELETED (Wave 0.3). It forced the atmosphere through 0x638699 at
// density 0.0024 at the exact 3->4 boundary and then undid it — a 3.0x luminance dip
// (rel-lum 0.659 -> 0.220 -> 0.659) and a 2.18x density spike across 196 world units, between
// two endpoints that were already the same colour. A bridge to nowhere. Its last consumer went
// in 4baac9c1; the export outlived it by a commit. Do not reintroduce a midpoint between
// identical endpoints — if a seam reads badly, the endpoints disagree and that is the bug.

// SEAM 4→5 bright-sky bridge (2026-08, Wave D): the day→sky handoff had NO colour bridge (only 3→4
// alpine + 5→6 aurora existed). A pale-cyan high-key midpoint so Ch4's bright azure eases into Ch5's
// deeper blue without a snap, matching the SEAM_34/56 treatment.
export const SEAM_45_COLOUR_HALF_WIDTH = 0.05;
export const SEAM_45_SKY_BRIDGE = Object.freeze({
    skyColor: 0x9fc6e8,
    fogColor: 0xc4dbee,
    ambientLight: 0xeaf2ff,
    ambientIntensity: 0.6,
    fogDensity: 0.0018,
});

export const SEAM_56_COLOUR_HALF_WIDTH = 0.07;
export const SEAM_56_AURORA_BRIDGE = Object.freeze({
    skyColor: 0x06162f,
    fogColor: 0x09283f,
    ambientLight: 0x1a4b5c,
    ambientIntensity: 0.32,
});
