/**
 * ACT II FOREST — the species roster (forest plan Wave 1).
 *
 * Frozen, import-free pure data (the `odyssey-cloud-field-specs.js` / peak-specs pattern), so
 * a test or a worker can read it without pulling in three.js.
 *
 * THE ROSTER LAW, from Firewatch: 23 hand-made trees carried a whole game at ~4,600
 * placements, ~14 of them doing 95% of the work, with rotation-only variation and repetition
 * hidden by density. "If you can get away with 23 trees, don't make 25" — every asset gets
 * retouched once or twice in production, so roster size IS iteration cost. Five archetypes is
 * the deliberate floor of that law, not a placeholder for something bigger.
 *
 * GROWTH STAGES, from The Witness: "I created a set of three, in different stages of growth,
 * which is usually the way I approach tree making. It is the best way to create an area that
 * feels like it is alive and still growing" (Orsi Spanyol). The stages here are proportion
 * changes only — no new builder, no new material, no new pipeline.
 *
 * ⚠️ VALUE ROLE IS AN AXIS OF ITS OWN, AND IT CAME OUT OF MEASUREMENT (plan §1b Wave 0c).
 * The plan was authored expecting ONE shade/lit ratio for the whole forest. Sampling the
 * owner's five reference frames refuted that: the ratio is a property of the SPECIES, and it
 * spans 0.22 to 0.94 across three clearly separated classes —
 *
 *   `anchor`    0.22-0.34  the dark punctuation (Witness cypress measured luma 18 against
 *                          luma-137 sand — an 8:1 contrast). These are the trees that give a
 *                          composition its black notes; there must be FEW of them.
 *   `workhorse` 0.43-0.78  everything that makes a forest a forest.
 *   `pastel`    0.83-0.94  blossom and pale gold. These barely darken at all: the reference
 *                          blossom shades by a saturation/magenta shift, not by a value drop,
 *                          and had NO dark mass anywhere on the canopy.
 *
 * Ref3's zone value ladder (cypress 18 << green 79 << mustard 137 < orange 149 < pink 162)
 * says zones separate by VALUE as much as by hue, which is why this axis lives here beside
 * the palette rather than being derived from it.
 *
 * ⚠️ AND THE SECOND MEASURED LAW: shade is DEEPER AND MORE SATURATED along the canopy's own
 * hue axis, never cooler and never greyer (normalised blue fell and saturation rose in 14 of
 * 15 measured reference pairs). So a species carries ONE crown colour plus a shade RECIPE
 * (saturation gain, value ratio) rather than two authored colours: a hand-authored shade
 * colour is exactly where a cool or desaturated shadow would creep back in.
 *
 * Colours are authored for the WORLD's output contract, not for the screen: in-game the world
 * hands the post stack `outputScale 0.82` / `outputSaturation 0.72` and the stack then applies
 * ACES plus master and chapter saturation. Authoring against the flat playground page is how
 * the cloud deck shipped "navy shards" after being tuned "soft grey".
 *
 * ⚠️ AND THE GRADE AMPLIFIES SATURATION, MEASURED. The first cut of these crowns was authored
 * at HSV saturation ~0.65 and came back through the real pipeline at **0.89**, against the
 * reference band of 0.46-0.75, with the whole forest reading dark (near-canopy luma 84 where
 * the Wave 0b probe measured 127). Master 1.15x and the chapter's further ~1.10x more than
 * undo the world's own 0.72 pull toward luma. These are therefore authored NOTICEABLY paler
 * and less saturated than the intended screen result — the opposite of the instinct, and the
 * same correction the Wave 0b crowns needed.
 */

/**
 * Shade recipes by value role. `sat` is a saturation GAIN (> 1 pulls away from the colour's own
 * luma — the measured direction); `value` is the final shade/lit luminance ratio, and it is
 * the ONLY term allowed to own that ratio.
 *
 * ⚠️ The value ratio is a FINAL-PIXEL ratio. Wave 0b's first probe spent it three times over
 * (an albedo scale, an occlusion floor and a dim ambient), measured p10 = 0.0 — literal black
 * after the grade's crush — and every individual constant looked defensible in isolation. One
 * owner, always.
 */
export const FOREST_VALUE_ROLES = Object.freeze({
    anchor: Object.freeze({ sat: 1.22, value: 0.30 }),
    workhorse: Object.freeze({ sat: 1.30, value: 0.58 }),
    pastel: Object.freeze({ sat: 1.45, value: 0.88 }),
});

/**
 * Altitude bands, in world units.
 *
 * ⚠️ SET FROM THE TERRAIN'S MEASURED DISTRIBUTION, NOT FROM THE TREE LINE — and the difference
 * is not small. The nominal plantable range is sea+3 (290.3) to the tree line (640), so the
 * first cut of this table spread four bands across it. Measuring where sites actually SURVIVE
 * the slope and density rejections gives a completely different island:
 *
 *   n=15,412   p10 303   p25 318   p50 348   p75 379   p90 390   p97 396   max 613
 *
 * **97% of the forest lives below y=396.** The massif flanks above that are steeper than the
 * 0.62 slope cap, so almost nothing stands there — Act II's forest is a coastal-and-lowland
 * forest, whatever the tree line says. Bands authored against 290-640 gave the upper two
 * species NO GROUND AT ALL: the subalpine fir scattered 0.0% of the island and the cypress
 * 0.1%, while both table entries looked perfectly reasonable. The band names describe position
 * within the ground that exists, not altitude in the abstract.
 */
export const FOREST_BANDS = Object.freeze({
    shore: Object.freeze({ lo: 288, hi: 325 }),
    lowland: Object.freeze({ lo: 315, hi: 358 }),
    slope: Object.freeze({ lo: 348, hi: 390 }),
    subalpine: Object.freeze({ lo: 380, hi: 460 }),
});

/**
 * The five archetypes.
 *
 * `builder` selects the geometry family: `conifer` is the drooping-tier lathe (the Firewatch
 * silhouette), `broadleaf` is the smin-lobe sculptor (the Witness canopy blob). `lobes` and
 * `tiers` are read by the matching builder and ignored by the other.
 *
 * `stages` are the three growth stages as multipliers on height and crown width, plus a
 * relative frequency — young trees are commoner than old ones in any real stand, and the
 * reference frames show the same.
 *
 * TIER COUNTS ARE MEASURED, not guessed: counting the reference Firewatch pines gave 5-7
 * discernible fan tiers on near heroes and 3-5 on distant ones (§1b R4). The plan was authored
 * saying 5-9; the measurement narrowed it, so the roster authors to 5-7.
 */
export const ODYSSEY_FOREST_SPECIES = Object.freeze([
    Object.freeze({
        id: 'S1-shore-broadleaf',
        builder: 'broadleaf',
        role: 'workhorse',
        band: 'shore',
        // THE WATER'S EDGE IS GREEN (owner reversal, 2026-08-15) — and this species needs no
        // flag to make that true. It carries the shore on its weight alone; what changed is
        // that the autumn species stopped outbidding it there. See the scatter's
        // FOREST_AUTUMN_LO note, including the mutation test that retired the flag.
        // The rounded olive lumps that fill the Witness shore and lowland — leaned toward
        // their bright lime-chartreuse in the vividness pass (B pulled hard down: chroma in
        // foliage lives in the R:G ratio and the ABSENCE of blue).
        crown: Object.freeze([0.175, 0.270, 0.078]),
        // A quieter ramp than the birch's: the reference greens vary too (yellow-green through
        // deep olive), just without crossing into another colour family.
        crownAlt: Object.freeze([0.105, 0.205, 0.062]),
        trunk: Object.freeze([0.098, 0.062, 0.040]),
        // 7, not 5: a Witness canopy is a countable cluster, and five lobes at this spread
        // leaves gaps that read as a lopsided ball rather than a crown.
        lobes: 7,
        crownW: 1.00,
        // Wider than tall — the reference broadleaf canopies are flattened domes, not spheres.
        crownH: 0.80,
        trunkR: 0.085,
        trunkH: 1.25,
        weight: 1.0,
        stages: Object.freeze([
            Object.freeze({
                id: 'young', h: 0.62, w: 0.68, freq: 0.42,
            }),
            Object.freeze({
                id: 'mature', h: 1.00, w: 1.00, freq: 0.42,
            }),
            Object.freeze({
                id: 'old', h: 1.34, w: 1.26, freq: 0.16,
            }),
        ]),
    }),
    Object.freeze({
        id: 'S2-workhorse-pine',
        builder: 'conifer',
        role: 'workhorse',
        band: 'lowland',
        // Shares the green water's edge with the shore broadleaf (owner reversal, 2026-08-15),
        // on weight rather than on a flag — see that species' note.
        // ⚠️ "Stay away from Christmas-tree shaped" (Orsi Spanyol) — the tier jitter and the
        // droop below are what buy that, and they are not decoration.
        crown: Object.freeze([0.138, 0.235, 0.100]),
        crownAlt: Object.freeze([0.095, 0.180, 0.088]),
        trunk: Object.freeze([0.115, 0.058, 0.034]),
        tiers: 6,
        crownW: 1.00,
        crownH: 1.00,
        trunkR: 0.055,
        trunkH: 1.00,
        droop: 0.30,
        weight: 1.0,
        stages: Object.freeze([
            Object.freeze({
                id: 'young', h: 0.58, w: 0.72, freq: 0.40,
            }),
            Object.freeze({
                id: 'mature', h: 1.00, w: 1.00, freq: 0.44,
            }),
            Object.freeze({
                id: 'old', h: 1.42, w: 1.12, freq: 0.16,
            }),
        ]),
    }),
    Object.freeze({
        id: 'S3-subalpine-fir',
        builder: 'conifer',
        role: 'workhorse',
        band: 'subalpine',
        // Bluer and narrower with altitude, and the only species that takes snow.
        crown: Object.freeze([0.104, 0.182, 0.128]),
        crownAlt: Object.freeze([0.072, 0.140, 0.115]),
        trunk: Object.freeze([0.088, 0.052, 0.040]),
        tiers: 7,
        crownW: 0.76,
        crownH: 1.12,
        trunkR: 0.048,
        trunkH: 0.92,
        droop: 0.20,
        snow: true,
        weight: 0.9,
        stages: Object.freeze([
            Object.freeze({
                id: 'young', h: 0.60, w: 0.74, freq: 0.44,
            }),
            Object.freeze({
                id: 'mature', h: 1.00, w: 1.00, freq: 0.42,
            }),
            Object.freeze({
                id: 'old', h: 1.30, w: 1.06, freq: 0.14,
            }),
        ]),
    }),
    Object.freeze({
        id: 'S4-gold-birch',
        builder: 'broadleaf',
        role: 'pastel',
        band: 'lowland',
        // (Was `waterline: true` — part of the autumn mix at the water's edge, 2026-08-14.
        // REVERSED by the owner on 2026-08-15 after the ground overhaul: against the old
        // olive-tan shoreline the golds read as a warm band, but against the new green meadow
        // they sat on top of it and flattened the one place the ground gained the most. The
        // gold birch keeps its lowland band and its share of the island — it simply no longer
        // outbids the greens for the last few metres before the sea.)
        autumnBand: true,
        // The pale accent. Placed as STANDS by the zone field, never as per-tree jitter — a
        // gold tree every twentieth trunk is noise; a grove of them is a place.
        // ⚠️ Its trunk is the measured exception: reference "white" trunks are canopy-TINTED
        // (a peach under an orange crown), never neutral, so this is a warm bone, not a grey.
        //
        // ⚠️ GOLD MEANS R ABOVE G. The first vivid pass measured our "gold" birch at
        // rgb(137,149,92) — GREEN above red, a chartreuse wash — against the reference
        // aspen's rgb(158,125,48), R:G ≈ 1.26. A yellow that keeps G on top never reads as
        // autumn gold whatever its saturation; the hue was wrong, not the intensity.
        // The ramp's BRIGHT end is a pale yellow, not the amber the first pass started from:
        // ref2 runs pale-yellow → gold → orange → deep red, and a ramp beginning at amber has
        // no light notes at all. The stand's whole tonal range is this pair.
        crown: Object.freeze([0.520, 0.435, 0.125]),
        // ⚠️ THE AUTUMN RAMP. A stand of one hue is not what the reference shows: its grove runs
        // pale gold -> amber -> orange -> deep red TREE BY TREE, and that spread is most of why
        // it reads as autumn rather than as yellow trees. Our per-tree jitter was a UNIFORM
        // SCALE — it moved value and preserved hue exactly, so every gold tree was the same
        // gold at a different brightness. `crownAlt` gives the species a second end and each
        // tree picks a point between: still one authored identity, never a rainbow, but a
        // grove instead of a repeat. The distribution is skewed toward the gold end
        // (FOREST_HUE_SKEW), so reds stay the minority accent they are in ref2.
        crownAlt: Object.freeze([0.395, 0.105, 0.040]),
        trunk: Object.freeze([0.255, 0.230, 0.196]),
        lobes: 6,
        crownW: 0.80,
        crownH: 0.94,
        trunkR: 0.062,
        trunkH: 1.55,
        weight: 0.55,
        stages: Object.freeze([
            Object.freeze({
                id: 'young', h: 0.66, w: 0.70, freq: 0.40,
            }),
            Object.freeze({
                id: 'mature', h: 1.00, w: 1.00, freq: 0.44,
            }),
            Object.freeze({
                id: 'old', h: 1.28, w: 1.14, freq: 0.16,
            }),
        ]),
    }),
    Object.freeze({
        id: 'S5-cypress-spike',
        builder: 'conifer',
        role: 'anchor',
        band: 'slope',
        // Ref3's dark exclamation marks: near-black columns (measured luma 15-19) against
        // luma-137 sand, reading as a single-file screen row rather than a filled zone.
        // ⚠️ SPARSE BY CONSTRUCTION — `weight` is the composition's black-note budget. Raising
        // it does not make the island more dramatic, it makes it uniformly dark.
        crown: Object.freeze([0.060, 0.100, 0.050]),
        trunk: Object.freeze([0.052, 0.036, 0.026]),
        tiers: 5,
        crownW: 0.34,
        crownH: 1.62,
        trunkR: 0.040,
        trunkH: 0.55,
        droop: 0.06,
        weight: 0.18,
        stages: Object.freeze([
            Object.freeze({
                id: 'young', h: 0.64, w: 0.86, freq: 0.36,
            }),
            Object.freeze({
                id: 'mature', h: 1.00, w: 1.00, freq: 0.46,
            }),
            Object.freeze({
                id: 'old', h: 1.36, w: 1.04, freq: 0.18,
            }),
        ]),
    }),
    Object.freeze({
        id: 'S6-red-maple',
        builder: 'broadleaf',
        role: 'workhorse',
        // STAYS on the shore band, and that is deliberate after a measurement.
        //
        // The 2026-08-15 reversal first moved it to `lowland` on the theory that a shore-banded
        // species returns to the shore by band fit whatever the boost says. True — but measured,
        // it deleted the species: red maple fell from 7% of the island to 0.2%, because in the
        // lowland it loses every site to the pine. The owner asked for this species by name.
        // So it keeps the shore band and simply no longer carries the waterline boost: the
        // greens outbid it across most of the water's edge, and it wins the few patch cores
        // where its own zone field is strongest. A handful of deep-red trees at the shore is
        // what the reference has; a wall of them was the thing being reversed.
        band: 'shore',
        // THE DEEP-RED MAPLE (owner-requested, 2026-08-14). Authored against ref2's measured
        // tree: lit rgb(100.7, 18.6, 9.3), HSV sat 0.907, luma 35 — near-black crimson, the
        // darkest broadleaf in the reference and effectively backlit in its frame. Its
        // measured shade/lit ratio (0.605) sits inside the workhorse band, so it keeps that
        // role; the DARKNESS is the albedo's job, not the recipe's. R:G is ~5.4 in the
        // reference — this is the vividness law's extreme case: red means almost no green.
        crown: Object.freeze([0.400, 0.072, 0.042]),
        // The ramp runs crimson → vermilion (ref2's separate vermilion tree, norm
        // 0.62/0.27/0.11, sits one step brighter than the maple — the pair spans both).
        crownAlt: Object.freeze([0.470, 0.160, 0.050]),
        trunk: Object.freeze([0.070, 0.042, 0.030]),
        lobes: 6,
        crownW: 0.95,
        crownH: 0.82,
        trunkR: 0.075,
        trunkH: 1.15,
        // (Was `waterline: true`. Reversed with the gold birch's — see that entry.)
        autumnBand: true,
        weight: 0.55,
        stages: Object.freeze([
            Object.freeze({
                id: 'young', h: 0.64, w: 0.70, freq: 0.40,
            }),
            Object.freeze({
                id: 'mature', h: 1.00, w: 1.00, freq: 0.44,
            }),
            Object.freeze({
                id: 'old', h: 1.30, w: 1.18, freq: 0.16,
            }),
        ]),
    }),
    Object.freeze({
        id: 'S7-pink-blossom',
        builder: 'broadleaf',
        role: 'pastel',
        band: 'lowland',
        // THE BLOSSOM GROVE (D4, decided by the owner 2026-08-14). The pastel role was built
        // from this tree's own measurement: ref3's blossom shades by a saturation/magenta
        // shift at ratio 0.936 with NO dark mass anywhere on the canopy — so the role's 0.88
        // value and 1.45 sat gain are its recipe verbatim. The hue is the roster's one
        // legitimate use of BLUE in a crown: ref3 measured lit rgb(238.7, 184.9, 241.3),
        // B ≈ R — pink is red-plus-blue, not desaturated red.
        crown: Object.freeze([0.470, 0.300, 0.430]),
        crownAlt: Object.freeze([0.430, 0.195, 0.330]),
        // The measured trunk law: "white" trunks are canopy-tinted, never neutral — warm bone.
        trunk: Object.freeze([0.240, 0.190, 0.170]),
        lobes: 6,
        crownW: 0.90,
        crownH: 0.78,
        trunkR: 0.058,
        trunkH: 1.30,
        // GROVES, not scatter: the scatter's grove clause concentrates it inside the top
        // slice of its own patch field — a place you walk into, the reference's showpiece.
        grove: true,
        weight: 0.30,
        stages: Object.freeze([
            Object.freeze({
                id: 'young', h: 0.66, w: 0.72, freq: 0.42,
            }),
            Object.freeze({
                id: 'mature', h: 1.00, w: 1.00, freq: 0.44,
            }),
            Object.freeze({
                id: 'old', h: 1.24, w: 1.12, freq: 0.14,
            }),
        ]),
    }),
]);

/**
 * Triangle budgets per LOD tier, asserted by `odyssey-forest.test.js`.
 *
 * ⚠️ LOD IS LOAD-BEARING, NOT AN OPTIMISATION — the same conclusion the cloud field reached
 * the hard way. Wave 0a's own instrument exists to price this; until it has, the budgets are
 * set against the INCUMBENT's 30 triangles per tree at 15,427 trees (462,810 total), and the
 * mix must not exceed ~1.25x that. A `hero` count added is a `hero` count removed elsewhere.
 */
export const FOREST_LOD_BUDGET = Object.freeze({
    hero: 560,
    mid: 90,
    // ⚠️ 24, RAISED FROM 18 ON EVIDENCE, not to make a failing number pass. An icosahedron is
    // 20 faces and is the cheapest genuinely ROUND closed hull there is; 18 came from the
    // research's "8-12-tri cone/teardrop", which describes a CONIFER. The far conifer still
    // costs 12. The far broadleaf needs a roundness the cone budget cannot buy, and the
    // audition board showed both cheaper attempts reading as flat kites.
    far: 24,
});

/**
 * Distance from the rail's ground track, in world units, at which each LOD tier takes over.
 *
 * ⚠️ SET FROM A MEASURED TRIANGLE LEDGER, not from intuition. Against the incumbent's 462,810
 * triangles at high quality, the whole roster scatters to:
 *
 *   hero<=150 mid<=700 -> 609,144 (1.32x)   524 hero / 3,613 mid / 11,264 far
 *   hero<=120 mid<=520 -> 526,630 (1.14x)   524 hero / 1,814 mid / 13,063 far   <- shipped
 *   hero<=110 mid<=420 -> 483,806 (1.05x)     524 hero /   997 mid / 13,880 far
 *   hero<=100 mid<=340 -> 476,412 (1.03x)     524 hero /   781 mid / 14,096 far
 *
 * 1.14x is inside the plan's <=1.25x resident-triangle target while keeping a mid tier worth
 * having; the two cheaper rows buy a few percent by collapsing the middle distance into the
 * 12-20 triangle far tier, which is where a forest starts reading as cardboard. The hero count
 * is unchanged across all four rows because hero chunks are decided on the fine grid and the
 * same chunks qualify either way — the lever is entirely the mid/far boundary.
 */
export const FOREST_LOD_DISTANCE = Object.freeze({
    hero: 120,
    mid: 520,
});

/**
 * THE FRAMING TREES (Wave 6, owner-directed finalisation 2026-08-14) — the cloud field's
 * FRAMING-role pattern applied to the forest: a small authored list of hero trees standing
 * beside the rail at named stations, so the journey's key beats are COMPOSED rather than left
 * to the scatter's dice. Positions are real rail-adjacent coordinates (offset ±28-30 u from
 * the path tangent, computed against the live spline); Y is NOT frozen — the scatter seats
 * each tree on the height mirror at build, so terrain edits cannot strand them.
 *
 * Stations at p≈0.28-0.30 were surveyed and EXCLUDED: the ground beside the rail there is
 * below the sea+3 planting floor (measured 232-280 against 290.3) — the rail is crossing
 * water, and a framing tree cannot stand in the lake.
 *
 * `old` growth stage, always; hero LOD regardless of distance bin. Eight trees total —
 * punctuation, not a plantation.
 */
export const ODYSSEY_FOREST_FRAMING = Object.freeze([
    // p≈0.34 — the shore ascent begins: a red maple over the water approach.
    Object.freeze({ x: -119, z: -256, species: 'S1-shore-broadleaf' }),
    Object.freeze({ x: -171, z: -231, species: 'S6-red-maple' }),
    // p≈0.42 — the canonical station: gold against green.
    Object.freeze({ x: -162, z: -383, species: 'S4-gold-birch' }),
    Object.freeze({ x: -218, z: -369, species: 'S1-shore-broadleaf' }),
    // p≈0.50 — the mixed slope: the autumn pair.
    Object.freeze({ x: -185, z: -489, species: 'S6-red-maple' }),
    Object.freeze({ x: -242, z: -502, species: 'S4-gold-birch' }),
    // p≈0.57 — the climb: two big conifers gate the path.
    Object.freeze({ x: -187, z: -541, species: 'S2-workhorse-pine' }),
    Object.freeze({ x: -245, z: -537, species: 'S3-subalpine-fir' }),
]);

/** Lookup helper. Returns undefined for an unknown id rather than throwing — callers gate. */
export function getForestSpecies(id) {
    return ODYSSEY_FOREST_SPECIES.find((s) => s.id === id);
}
