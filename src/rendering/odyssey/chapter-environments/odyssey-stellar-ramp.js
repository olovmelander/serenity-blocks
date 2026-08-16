/**
 * @fileoverview THE STELLAR RAMP — chapter 6's near-star colour law (Wave 5).
 *
 * docs/ODYSSEY_CH6_SPACE_OVERHAUL_PLAN_2026-08.md §5 Wave 5: "near-star batch,
 * quantised blackbody ramp".
 *
 * WHAT THIS REPLACES. `createVoidStars` used to pick from two hand-mixed arrays —
 * `hotPalette` (5 entries) and `tintPalette` (5 entries) — chosen by a bare
 * `Math.random() > 0.3` split. Ten colours with no relation to each other, and colour
 * completely uncorrelated with size or core punch, so a huge sprite was as likely to be
 * dim amber as hot blue. Against the composition contract (§3b rule 5, Gurney: keep the
 * big-soft and the tiny-sharp, DELETE THE MIDDLE) that is exactly the mush the rule
 * warns about: every star was a slightly different nothing.
 *
 * WHAT REPLACES IT. Stars are already quantised in nature — the spectral sequence is a
 * temperature ladder, so the "flat bands, not gradients" law the rest of this chapter
 * paints by (Wave 4's terminator, the accretion rings, the dome) is the PHYSICAL answer
 * here, not a stylisation. Six classes sampled off the blackbody locus (Charity's
 * table, sRGB, normalised so the brightest channel is 1.0), each carrying its own
 * emissive push, size gain and core exponent gain.
 *
 * THE THREE GAINS ARE THE POINT — they are what makes the class READ:
 *   - `emissive`  hot classes are pushed past 1.0 so they clip into bloom and the field
 *                 has real hierarchy; cool classes sit under 1.0 and stay quiet.
 *   - `sizeGain`  hot blues are the bright anchors, and the rare M giants are BIG...
 *   - `coreGain`  ...but soft — a giant is large and dim, which is how you tell it from
 *                 a near blue-white. Size alone would just make it a bigger pinpoint.
 *
 * WEIGHTS ARE NOT A MASS FUNCTION. A real volume is overwhelmingly M dwarfs; a real
 * *naked-eye* sky is overwhelmingly hot and luminous, because the faint ones are not
 * visible. This field paints what a viewer sees, so the weights follow the visible sky:
 * dominated by F/A white and blue-white with warm accents rare enough to be an event.
 */

/**
 * The ladder, cool → hot. Frozen: these are authored values judged against the blessed
 * refs, not tuning knobs — change them in a probe first (see the Wave 5 probe effect).
 * `weight` entries are relative and are normalised by `pickStellarClass`, so adding a
 * class does not silently re-scale the others.
 */
export const STELLAR_CLASSES = Object.freeze([
    Object.freeze({
        id: 'M',
        kelvin: 3000,
        color: Object.freeze([1.000, 0.706, 0.420]),
        weight: 0.06,
        emissive: 0.86,
        sizeGain: 1.35,
        coreGain: 0.70,
    }),
    Object.freeze({
        id: 'K',
        kelvin: 4500,
        color: Object.freeze([1.000, 0.855, 0.706]),
        weight: 0.12,
        emissive: 0.92,
        sizeGain: 1.05,
        coreGain: 0.85,
    }),
    Object.freeze({
        id: 'G',
        kelvin: 5800,
        color: Object.freeze([1.000, 0.957, 0.918]),
        weight: 0.18,
        emissive: 0.98,
        sizeGain: 0.95,
        coreGain: 0.95,
    }),
    Object.freeze({
        id: 'F',
        kelvin: 7000,
        color: Object.freeze([0.973, 0.969, 1.000]),
        weight: 0.28,
        emissive: 1.06,
        sizeGain: 1.00,
        coreGain: 1.00,
    }),
    Object.freeze({
        id: 'A',
        kelvin: 9500,
        color: Object.freeze([0.824, 0.867, 1.000]),
        weight: 0.26,
        emissive: 1.18,
        sizeGain: 1.10,
        coreGain: 1.10,
    }),
    Object.freeze({
        id: 'B',
        kelvin: 15000,
        color: Object.freeze([0.710, 0.780, 1.000]),
        weight: 0.10,
        emissive: 1.30,
        sizeGain: 1.25,
        coreGain: 1.20,
    }),
]);

const TOTAL_WEIGHT = STELLAR_CLASSES.reduce((sum, c) => sum + c.weight, 0);

/**
 * Draw one class from the weighted ladder. `rng` must be a 0..1 generator — pass a
 * SEEDED one (makeRng / the chapter's inline hash) so the field is byte-reproducible
 * across builds: the asteroid garland was re-rolling its seats every reload under bare
 * `Math.random`, which made every capture A/B incomparable (commit e9ccc0f6).
 */
export function pickStellarClass(rng) {
    let r = rng() * TOTAL_WEIGHT;
    for (let i = 0; i < STELLAR_CLASSES.length; i += 1) {
        r -= STELLAR_CLASSES[i].weight;
        if (r <= 0) return STELLAR_CLASSES[i];
    }
    return STELLAR_CLASSES[STELLAR_CLASSES.length - 1];
}
