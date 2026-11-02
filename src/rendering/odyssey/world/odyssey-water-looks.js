/**
 * ODYSSEY ACT II — THE WATERS' LOOKS (2026-11-02): the sea's and the north lake's pigments and
 * the settings of the terms the world renderer shades them with, plus CPU twins of the formulas
 * the tests hold (the depth colour, the sea's horizon dissolve from above, its surf line from afar,
 * the lake's soft shore). Three-free.
 *
 * The twins mirror the shader in odyssey-world-renderer.js line for line (`waterRampBody`, the
 * dissolve, `buildShoreFoam`'s surf line, the lake's opacity and wet lip). Change both together.
 */
import { ODYSSEY_WATER_RAMP } from '../odyssey-colour-script.js';

/**
 * THE NORTH LAKE'S WATER (2026-11-02, Olov: "Real water for the lake ... reflections of the sky
 * and clouds, a turquoise-to-blue depth colour, and a soft shoreline instead of a hard dark
 * edge"). The lake is now the island's one water, like the sea and the tarn: the shared `water*`
 * terms with a few lake settings.
 *
 * `LAKE_RAMP` is its pigment: turquoise over the shelf, teal, then a deep blue in the middle. It is
 * bluer than the tarn's glacial jade (a big lowland lake, not a snow-fed pool) and greener than
 * the sea. Authored in the world's linear working space, before `toOutput` (x0.82, saturation
 * 0.72) and the land aerial, so it is deeper and more saturated than the pixel it lands on.
 */
export const LAKE_RAMP = Object.freeze({
    shore: Object.freeze([0.20, 0.70, 0.68]),
    shelf: Object.freeze([0.08, 0.52, 0.62]),
    open: Object.freeze([0.04, 0.34, 0.56]),
    deep: Object.freeze([0.03, 0.20, 0.44]),
});
/**
 * The lake's settings for the shared water terms:
 * - `absorb`: the ramp's depth driver, t = 1 - 2^(-depth * absorb). The bowl's walls are steep
 *   (the carve reaches ~11 u of depth 9 u inside the rim), so a quick absorption would leave the
 *   turquoise a sub-pixel line from the climb. At 0.065 the plates step at ~3, 10 and 22 u of
 *   depth: the first ~3 u are turquoise, the arms (4-11 u deep) teal, and only the main basin
 *   (to ~45 u) turns deep blue.
 * - `calm`: the sea's ripple slope scaled for a big sheltered lake, between the tarn and the sea;
 *   `rippleFade`: the range (u) over which that fine ripple gives way, because it is finer than a
 *   pixel from the climb; `swell`, `swellScale`: the broad undulation that bends the reflection
 *   from afar instead (its slope gain, and the bake's scale per unit).
 * - `fresnel`: [gain, floor] of the sky's share. Seen from the climb at 30-50 degrees the gain
 *   adds almost nothing, so the floor is what shows the sky and the clouds in the water. Higher
 *   and the big cumulus over the lake turn it milky.
 * - `shore`, `shorePx`: the soft shoreline. The water thins to nothing over this many units of
 *   depth, or this many pixels' worth of it from afar, whichever is wider.
 * - `lip`: the pale wet line along the shore (its strength).
 */
export const LAKE_WATER = Object.freeze({
    absorb: 0.065,
    calm: 0.5,
    rippleFade: Object.freeze([300, 900]),
    swell: 0.5,
    swellScale: 0.0042,
    fresnel: Object.freeze([0.62, 0.24]),
    shore: 1.6,
    shorePx: 3.0,
    lip: 0.22,
});
/**
 * The sea turns blue sooner (2026-10-31, "can we improve the water in the ocean"): a gain on the
 * colour script's measured absorption. At 1 the visible sea sat in the ramp's pale upper plates
 * from every Act II station, a milky aqua; above 1 the same depths reach cerulean and cobalt.
 */
export const SEA_ABSORB_GAIN = 2.6;
/**
 * THE WATERS' OWN PIGMENTS (water pass, 2026-10-31, "do what you think will be most beautiful").
 * This is a cool northern island (a snowy horn, conifers, meadows): its sea is turquoise only in
 * the thin band over the sand and turns a deep teal-blue within a few metres, clear and cold, like
 * the Lofoten or Fiordland coasts; the colour script's ramp (Act I's, unchanged) leaned tropical,
 * a wide band of bright aqua that was the most saturated thing in every frame. The sea keeps the
 * script's turquoise for the sand and steps through teal to a blue-green deep. The tarn under the
 * horn is fed by its snow: the milky jade-turquoise of glacial flour, brighter and less saturated
 * than the sea and nearly opaque, so it reads as an alpine lake rather than a pool. Both keep the
 * script's four plates (`bands`) and every other water term in common.
 */
export const SEA_RAMP = Object.freeze({
    shore: ODYSSEY_WATER_RAMP.shore,
    shelf: Object.freeze([0.10, 0.41, 0.50]),
    open: Object.freeze([0.05, 0.27, 0.40]),
    deep: Object.freeze([0.03, 0.15, 0.24]),
});
/**
 * THE SEA FROM ABOVE (2026-11-02, "the whole sea stops looking milky and flat"). The horizon
 * dissolve fades with how steeply the eye looks down at the water: the sines of the angles where
 * it starts to let go (~3 degrees) and where it is gone (~14 degrees). See the dissolve.
 */
export const SEA_HORIZON_DOWN = Object.freeze([0.05, 0.25]);
/**
 * THE SURF LINE FROM AFAR (2026-11-02): the soft white line on the waterline once a pixel spans
 * more depth than the swash front. Its width in pixels (calm, at the top of a run-up), how much of
 * it a broken stretch keeps, the scale of the drifting field that breaks it (per unit), and its
 * strength. `thinPx`, `thinKeep`: where one pixel spans more than the whole surf zone (metres of
 * depth a pixel, from-to) the foam is only part of that pixel, so the line thins to `thinKeep`.
 */
export const SEA_SURF = Object.freeze({
    widthPx: Object.freeze([2.4, 3.6]),
    broken: 0.45,
    breakScale: 0.0045,
    gain: 0.70,
    thinPx: Object.freeze([2.0, 8.0]),
    thinKeep: 0.4,
});

// ── CPU twins ─────────────────────────────────────────────────────────────────────────────────

const clamp01 = (x) => Math.min(Math.max(x, 0), 1);
/** WGSL's smoothstep (reversed edges allowed). */
export function smoothstepGpu(e0, e1, x) {
    const t = clamp01((x - e0) / (e1 - e0));
    return t * t * (3 - (2 * t));
}
const fract = (x) => x - Math.floor(x);
const mix3 = (a, b, t) => [0, 1, 2].map((i) => a[i] + ((b[i] - a[i]) * t));

/**
 * The pigment ramp at driver `t` in its flat plates (`waterRampBody`): `bands` plates with an
 * anti-aliased riser, walked shore -> shelf -> open -> deep.
 * @param {number} t 0..1
 * @param {{shore:number[], shelf:number[], open:number[], deep:number[]}} ramp
 * @returns {number[]} rgb
 */
export function waterRampColour(t, ramp, bands = ODYSSEY_WATER_RAMP.bands) {
    const cell = t * bands;
    const seg = ((Math.floor(cell) + smoothstepGpu(0.45, 0.55, fract(cell))) / bands) * 3;
    return mix3(
        mix3(mix3(ramp.shore, ramp.shelf, clamp01(seg)), ramp.open, clamp01(seg - 1)),
        ramp.deep,
        clamp01(seg - 2),
    );
}

/** The lake's body colour over `depth` units of water. */
export function lakeBodyAt(depth) {
    return waterRampColour(clamp01(1 - (2 ** (-depth * LAKE_WATER.absorb))), LAKE_RAMP);
}

/** The sea's body colour over `depth` units of water. */
export function seaBodyAt(depth) {
    const k = ODYSSEY_WATER_RAMP.absorptionPerMetre * SEA_ABSORB_GAIN;
    return waterRampColour(clamp01(1 - (2 ** (-depth * k))), SEA_RAMP);
}

/**
 * How much of the horizon dissolve a sea fragment keeps, by the sine of how steeply the eye looks
 * down at it (`viewDir.y`): 1 looking along the water, 0 looking down on it.
 */
export function seaHorizonKeep(downSine) {
    return 1 - smoothstepGpu(SEA_HORIZON_DOWN[0], SEA_HORIZON_DOWN[1], downSine);
}

/**
 * The surf line from afar (`buildShoreFoam`): its weight at a fragment over `depth` units of
 * water, where one pixel spans `depthPx` of depth, at swash `pulse` (0..1) and break-up noise
 * `breakN` (0..1). Before SEA_SURF.gain.
 */
export function seaSurfLine(depth, depthPx, pulse = 0, breakN = 1) {
    const px = Math.max(depthPx, 1e-3);
    const u = depth / px;
    const width = SEA_SURF.widthPx[0] + ((SEA_SURF.widthPx[1] - SEA_SURF.widthPx[0]) * pulse);
    return smoothstepGpu(-1.0, 0.4, u)
        * (1 - smoothstepGpu(1.0, width, u))
        * (SEA_SURF.broken + ((1 - SEA_SURF.broken) * smoothstepGpu(0.30, 0.62, breakN)))
        * smoothstepGpu(0.3, 1.2, px)
        * (1 - (smoothstepGpu(SEA_SURF.thinPx[0], SEA_SURF.thinPx[1], px) * (1 - SEA_SURF.thinKeep)));
}

/** The width (units of depth) of the lake's soft shore where one pixel spans `depthPx`. */
export function lakeShoreWidth(depthPx) {
    return Math.max(LAKE_WATER.shore, depthPx * LAKE_WATER.shorePx);
}

/** The lake film's opacity over `depth` units of water. */
export function lakeShoreOpacity(depth, depthPx) {
    return smoothstepGpu(0, lakeShoreWidth(depthPx), depth);
}

/** The lake's pale wet line (its mix weight toward the lip colour). */
export function lakeWetLip(depth, depthPx) {
    const w = lakeShoreWidth(depthPx);
    return (1 - smoothstepGpu(0, w * 0.6, depth)) * smoothstepGpu(w * -0.1, w * 0.15, depth) * LAKE_WATER.lip;
}
