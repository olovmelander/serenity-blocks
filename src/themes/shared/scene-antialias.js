/**
 * Scene-pass antialiasing for themes whose post stack draws the scene into its own target
 * (`pass(scene, camera)`): the canvas's MSAA never reaches that picture, so the pass must carry
 * its own samples.
 *
 * From High up the pass takes 4× MSAA, as Sky Children's does: trunks, needles, ridgelines and
 * shorelines against a bright sky or water then step smoothly instead of in single pixels. Below
 * High, and with the game's antialiasing setting off, the pass stays single-sampled and the theme
 * keeps whatever it did before (FXAA, or nothing).
 *
 * A planar `reflector()` drawn beside such a pass takes the same count: a material drawn into
 * targets of two sample counts compiles two pipelines
 * (docs/theme-perf/STATIC_STARTUP_AUDIT_2026-10.md, P3).
 */
const MSAA_TIERS = Object.freeze({ Extreme: 4, Ultra: 4, High: 4 });

/**
 * Samples for a theme's scene pass at a quality tier.
 * @param {string} quality effect-quality tier name
 * @param {boolean} [antialias] the game's antialiasing setting
 * @returns {number} 4 or 0
 */
export function sceneSamples(quality, antialias = true) {
    if (!antialias) return 0;
    return Object.prototype.hasOwnProperty.call(MSAA_TIERS, quality) ? MSAA_TIERS[quality] : 0;
}
