/**
 * THE GROUND PALETTE — Act II's terrain, authored against the measured reference bar.
 *
 * Every number here is a MEASURED band from the ground plan's §1b (sampled from the owner's
 * five reference frames with the decile-verified box sampler), not a taste setting — so a
 * capture that misses the bar names the constant to move instead of starting an argument.
 * See docs/ODYSSEY_ACT2_GROUND_PLAN_2026-08.md.
 *
 * WHY A TABLE AND NOT FOUR CONSTANTS IN THE SHADER. What shipped before this file was
 * literally four `vec3` literals inline in the fragment graph (grass, sand, rock, snow) with
 * a ±3.5 % sine plaid over the top, and the diagnosis of the whole "tinted playdough" read
 * was that a single constant per biome cannot express any of the measured structure: not the
 * value LADDER between adjacent surfaces (G3), not the metre-scale patch variegation that
 * makes a Witness lawn read as a lawn (G6), and not the two different SHADOW MODELS the
 * references use (G1). Each material therefore gets two poles and a named shadow model.
 *
 * THE POLES ARE A MOISTURE AXIS, not a random-variation axis. Damp ground is darker and
 * greener; dry ground is paler, warmer and — for grass — GOLDEN, with red above green. That
 * is measured, not stylistic: ref1's lawn holds golden 126/92/35 (norm .498/.364/.138, red
 * ABOVE green) directly beside green 96/108/35, one lawn, two hues. The moisture field baked
 * into the sun texture's B channel picks the point on the axis, so patch variegation is a
 * consequence of world logic (concavity, altitude, sun aspect) rather than of noise —
 * "it converts height bands into a place".
 *
 * AUTHORED VALUES OVERSHOOT. The world hands the stack a flatter image than the screen shows
 * (outputScale 0.82 / outputSaturation 0.72, then master 1.15 and chapter ~1.10 grade), so
 * these are deliberately hotter than the screen targets in the comments beside them.
 */

/**
 * The four material families. `damp`/`dry` are the moisture poles; `shade` names which of the
 * two measured shadow models the material obeys.
 *
 * Screen targets (G2): lit vegetation/sand sat 0.56-0.79, lit rock sat 0.10-0.38.
 */
export const ODYSSEY_GROUND_PALETTE = Object.freeze({
    // Ref1 lawn green 96/108/35 (norm .401/.453/.146) and golden 126/92/35 (.498/.364/.138);
    // ref4 grass 144/126/41 (.463/.405/.132) — the dry pole must cross over to red ≥ green or
    // the island can only ever be "a green place".
    // ...and grass is the island's MID-DARK ANCHOR, not a bright surface. Measured on the
    // first capture: our grass screened at luma 180 against the massif's 208, a ratio of 1.15,
    // while the references hold pale rock at 1.65-2.1x ABOVE grass (ref1: white rock 208, path
    // 163, grass 95-100). The ladder was nearly inverted, which is why the island read as one
    // pale mass no matter what its hues did. These poles are the earlier ones scaled to ~0.62
    // luma with their saturation held at 0.78-0.80 — value comes down, colour does not.
    grass: Object.freeze({
        damp: Object.freeze([0.090, 0.199, 0.043]),
        dry: Object.freeze([0.257, 0.204, 0.052]),
        shade: 'vegetation',
    }),
    // Ref3 sand 234/205/101 at sat 0.57 AND luma 204 — G9: bright and saturated coexist. The
    // damp pole is the waterline (ref3 waterline sand 177/139/73 = 0.7x the dry hill).
    sand: Object.freeze({
        damp: Object.freeze([0.56, 0.40, 0.17]),
        dry: Object.freeze([0.86, 0.67, 0.31]),
        shade: 'vegetation',
    }),
    // Ref2 pale ledge 132/124/106 (sat 0.20), ref4 canyon rock 169/145/104 (sat 0.32-0.38).
    // Rock is the LOW-saturation family — that contrast against 0.56-0.79 vegetation IS the
    // material identity (G2), so pushing rock saturation up to match the trees would delete it.
    rock: Object.freeze({
        damp: Object.freeze([0.37, 0.31, 0.25]),
        dry: Object.freeze([0.60, 0.51, 0.38]),
        shade: 'mineral',
    }),
    // Warmed off blue-white so peaks read sunlit; the damp pole is old/compacted snow.
    snow: Object.freeze({
        damp: Object.freeze([0.88, 0.90, 0.93]),
        dry: Object.freeze([0.99, 0.97, 0.92]),
        shade: 'mineral',
    }),
});

/**
 * THE TWO SHADOW MODELS (G1) — the single most load-bearing measurement in the bar, and the
 * ground twin of the forest's foliage-shade law.
 *
 * VEGETATION, SOIL AND SAND keep their chromaticity and their HSV saturation EXACTLY, and
 * lose only value: ref2's orange leaf ground measures sat 0.76 lit and 0.74 shaded with
 * identical norms, at luma x0.57; ref4's grass is .463/.405/.132 on BOTH sides at x0.50. A
 * scalar multiply reproduces that by construction, which is why `desat` is zero here — the
 * cheapest possible term is also the correct one.
 *
 * ROCK does the opposite: it DESATURATES toward neutral/mauve. Ref2's ledge falls sat
 * 0.33 -> 0.06, ref4's boulder 0.38 -> 0.23, and in both the blue FRACTION rises (.25 -> .30).
 * Note what that means mechanically: desaturating a warm colour raises its relative blue on
 * its own, so `desat` OWNS the measured hue shift and no blue tint is added anywhere. That is
 * the one-owner law — a measured ratio may be produced in exactly one term.
 *
 * DEEP SHADE is red-enriched in every reference (ref4's shadowed path goes norm-r .44 -> .51,
 * ref5's dusk shadows .51 red) and lands at x0.27-0.32. It is never blue-black. This is the
 * term that makes the world's cool ambient (`uShadowTint`) safe on the ground: the ambient
 * still fills the shadow, but the material's own deep tint decides its colour.
 */
export const ODYSSEY_GROUND_SHADE = Object.freeze({
    vegetation: Object.freeze({
        /**
         * How bright this material is where the sun does not reach it, as a fraction of full
         * sun — the sky fill, and the quantity the bar actually measures. Ref2's leaf ground
         * sits at x0.57 of its lit self, ref4's grass at x0.50, and deep shade across every
         * reference lands at x0.27-0.32. With Lambert doing the rest (see `terminator`), an
         * ambient of 0.28 produces BOTH: 0.28 where the sun never lands, and 0.57 between a
         * grazing face and a well-lit one.
         */
        ambient: 0.28,
        /** Zero BY MEASUREMENT: chromaticity and saturation are preserved exactly. */
        desat: 0.0,
    }),
    mineral: Object.freeze({
        /**
         * Ref2's ledge reads 1:1.65 (0.61) and ref4's boulder 1:2.3 (0.43); rock takes the
         * DEEPER end of that spread, because rock is where the shadow does structural work —
         * the first capture of this graph put the massif at 0.52 with a wide terminator and
         * the mountain lost its shadow side entirely, reading as one pale silhouette. A
         * measured band is a range to choose inside, not a single number to average.
         */
        ambient: 0.22,
        /**
         * Ref2 sat 0.33 -> 0.06 is a 0.82 collapse; ref4 0.38 -> 0.23 is 0.39. At 0.68 the
         * massif's shadow face measured sat 0.023 — past even ref2's floor, i.e. a rock that
         * goes properly grey rather than mauve. Split the difference of the two references.
         */
        desat: 0.56,
    }),
    /** Ambient in a hollow the sky cannot see into. Drives the wide-AO half of the shading. */
    deepAmbient: 0.13,
    /**
     * Red-enriched, never blue-black (G1). Multiplies the shaded colour only, and authored
     * LUMA-NEUTRAL on purpose (0.2126/0.7152/0.0722 weights sum to 0.997): the ratio belongs to
     * `ratio`, so a tint that also darkened would be a second owner of the same measurement.
     */
    deepTint: Object.freeze([1.13, 0.97, 0.88]),
    /**
     * THE TERMINATOR, and the mistake worth keeping.
     *
     * The Ghibli two-mass law says light and shadow separate with a narrow terminator and that
     * mid-tones live on the LIT side only. The first cut read that as "everything above the
     * window is fully lit" and used [0.015, 0.34] — which is narrow, but measured against the
     * wrong quantity: a face at ndl 0.3 is genuinely dimmer than a face at ndl 1.0, so
     * saturating there deleted every mid-tone the lit side is supposed to own. MEASURED on the
     * first capture: the massif's shadow face lifted from 0.26 to 0.60 of its lit face and the
     * mountain flattened into one pale silhouette.
     *
     * The SECOND cut narrowed the window to the boundary and gave the lit side its own ramp —
     * measured worse: the massif came back at 0.80, because a mountain has a great many faces
     * at ndl 0.05-0.30 and a window ending at 0.15 declares all of them fully lit. The THIRD
     * widened the window to [0.02, 0.50] and measured 0.82, for the same reason one step out.
     *
     * The mistake all three shared was treating the measured ratio as something a REMAP has to
     * produce. It is not: plain Lambert already produces it. A face at ndl 0.35 beside one at
     * ndl 0.70 is half as bright, which is the measured band, and the shipped graph — a linear
     * `ndl * 0.92 + 0.06` — sat at 0.58 inside it all along. What the shipped graph got wrong
     * was only the FLOOR (0.06 where the references say 0.27-0.32).
     *
     * So the light model is now Lambert, shaped by one classic smoothstep S-curve whose
     * shoulders do the two-mass grouping, lifted by a per-material ambient (`ambient` above)
     * that owns the floor. The window is the full [0, 1] Lambert range: this array stays only
     * so the curve's ends are named and testable.
     */
    terminator: Object.freeze([0.0, 1.0]),
});

/**
 * ROCK'S SHAPE LANGUAGE (G5/G10). Cliff faces in both reference games read as 2-3 discrete
 * VALUE STEPS per form, not as gradients: the deciles of a captured cliff step 132 -> 203
 * (ref3 sand cliff), 128 -> 221 (travertine), 122 -> 218 (ref1 white rock) — bands of 30-45
 * luma with flat interiors. The Witness got that from sculpted geometry ("hard edges are not
 * evil… faceting became a powerful tool"); a heightfield cannot, so the bands are shaded.
 *
 * The band index is quantised world Y, warped by the atlas so the strata wobble like
 * sediment instead of drawing a contour map, and gated to slope so meadows never band.
 */
export const ODYSSEY_GROUND_STRATA = Object.freeze({
    /** World units per stratum. ~24 u reads as a stack of slabs at rail distance. */
    band: 24,
    /**
     * Value step between adjacent strata. 0.16 measured as invisible on the massif capture —
     * +-8% of value on a pale rock is below the threshold where an eye reads a band at all —
     * against the bar's 30-45 luma out of ~200, which is +-13..18%. Authored at the bar.
     */
    step: 0.36,
    /** How far the atlas warps a band boundary, in world units. Wider than the noise swing. */
    warp: 30,
    /**
     * Strata appear on rock faces only — below this slope the ground is landform, not rock.
     *
     * DEBUG-SHADED, not guessed: a capture with the ground re-coloured to
     * `vec3(strataAmt, slope, kRock)` showed the term alive only on the massif's summit cone,
     * which is exactly where SNOW covers it — so the bands existed and nothing could ever see
     * them. The visible rock flanks of this island sit at slope 0.10-0.30, not above 0.26.
     * (This is the file's own version of the standing law: prove a term with a constant, not by
     * tuning its amplitude until something appears.)
     */
    slope: Object.freeze([0.10, 0.26]),
});

/**
 * DISTANCE DISCIPLINE (rule 7, and Sable's law: in a flat-shaded world the distance gradient
 * IS the style). Detail must melt to the macro paint BEFORE aerial perspective dominates, and
 * the far ground pre-desaturates toward the aerial hue so the mid-field reads as clean painted
 * masses rather than as dimmed noise. Both are footprint-driven, so they cost nothing extra:
 * `footprint` is already computed for the bump gates.
 */
export const ODYSSEY_GROUND_DISTANCE = Object.freeze({
    /** Atlas detail melts across this footprint window (world units per screen pixel). */
    detailMelt: Object.freeze([1.6, 11]),
    /**
     * FAR PRE-DESATURATION — REMOVED, and kept here as a named zero so nobody re-adds it
     * without reading why.
     *
     * The idea was Sable's: with flat shading the distance gradient is nearly the only depth
     * cue, so the far field should resolve into clean painted masses before aerial perspective
     * mixes it toward the sky. Measured twice, it did the opposite. At 0.62 it took the distant
     * peak from sat 0.183 to 0.028; talked down to 0.84 it still cost 0.07 of saturation
     * (0.183 -> 0.114) against a bar that says a hazed mountain keeps 0.25-0.53. The reason is
     * structural: this pull is toward the fragment's own LUMA, which is grey, while G7's
     * measurement is that distance desaturates toward a HUE. Aerial perspective already does
     * the hue version, and the detail MELT already does the "clean masses" half. A term that
     * measured negative twice and duplicates two terms that measured positive does not ship.
     */
    presat: 1.0,
    presatWindow: Object.freeze([25, 140]),
});

/**
 * MOISTURE — how the baked field maps onto the palette poles. The field is authored in the
 * bake (concavity + altitude + sea proximity - sun exposure); this is the only place that
 * decides how strongly it is allowed to speak, per material. Snow barely moves (a snowfield
 * is a snowfield); grass moves the most, because the two-hue lawn is the measured signature.
 */
export const ODYSSEY_GROUND_MOISTURE = Object.freeze({
    grass: 1.0,
    sand: 0.75,
    rock: 0.85,
    snow: 0.35,
});

/**
 * THE DRYNESS CURVE — where on the moisture axis the dry pole starts to speak.
 *
 * A linear read of the field made the whole shoreline plain straw-gold on the first capture,
 * because the midpoint of a two-pole lerp is already half-way to the golden pole and the
 * midpoint is where most of the island sits. The references do not work that way: ref1's lawn
 * is GREEN with golden patches, not a uniform blend of the two. So dryness is a shaped read —
 * green is the default, and gold arrives only where the field says the ground is genuinely dry.
 * Reversed window (hi, lo) because the input is moisture and the output is dryness.
 *
 * NOTE the window is the ONLY lever on how much of the island goes gold. The moisture field is
 * percentile-stretched over land, so raising or lowering its terms uniformly is a no-op by
 * construction — it can only change the ORDERING of places, never the proportion. That cost a
 * capture to learn: rebalancing the bake's constants moved the massif station by almost nothing.
 */
export const ODYSSEY_GROUND_DRYNESS = Object.freeze([0.58, 0.06]);

/** Linear-ish luma weights, matching the ones the output stage already uses. */
export const ODYSSEY_GROUND_LUMA = Object.freeze([0.2126, 0.7152, 0.0722]);

/**
 * Luma of an authored triple, for tests that assert the measured value LADDER (G3) survives
 * palette edits: paths/pale rock must stay above grass, damp must stay below dry.
 */
export function groundPaletteLuma(rgb) {
    return (rgb[0] * ODYSSEY_GROUND_LUMA[0])
        + (rgb[1] * ODYSSEY_GROUND_LUMA[1])
        + (rgb[2] * ODYSSEY_GROUND_LUMA[2]);
}

/** HSV saturation of an authored triple — the G2 instrument. */
export function groundPaletteSaturation(rgb) {
    const hi = Math.max(rgb[0], rgb[1], rgb[2]);
    const lo = Math.min(rgb[0], rgb[1], rgb[2]);
    return hi <= 0 ? 0 : (hi - lo) / hi;
}
