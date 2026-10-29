/**
 * Scene-pass antialiasing for themes whose post stack draws the scene into its own target
 * (`pass(scene, camera)`): the canvas's MSAA never reaches that picture, so the pass must carry
 * its own samples.
 *
 * From High up the pass takes 4× MSAA, as Rainbow Terraces' does: trunks, needles, ridgelines and
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

/**
 * Whether a theme's CANVAS should be multisampled (`new WebGPURenderer({ antialias })`).
 *
 * When a post stack draws the scene into its own pass, the canvas receives only the output quad,
 * which covers every pixel: its four samples are always equal, so MSAA there changes no pixel but
 * still costs a 4x colour (and depth) target plus its resolve on every frame (2026-10-27 fleet
 * bench: the forest family, aurora and wolfhour paid it at High on top of their 4x scene pass).
 * Only a tier that draws the scene straight to the canvas (post off) needs the canvas's MSAA.
 * @param {boolean} antialias the game's antialiasing setting
 * @param {boolean} sceneDrawsToCanvas true when the tier renders the scene to the canvas itself
 * @returns {boolean}
 */
export function canvasAntialias(antialias, sceneDrawsToCanvas) {
    return Boolean(antialias && sceneDrawsToCanvas);
}
