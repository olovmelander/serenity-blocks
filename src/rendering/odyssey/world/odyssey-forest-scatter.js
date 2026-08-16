import {
    FOREST_BANDS,
    FOREST_LOD_DISTANCE,
    FOREST_VALUE_ROLES,
    ODYSSEY_FOREST_FRAMING,
    ODYSSEY_FOREST_SPECIES,
} from './odyssey-forest-species.js';
import { railSeesForestSite } from './odyssey-forest-visibility.js';
import { ODYSSEY_NORTH_LAKE } from './odyssey-world-height.js';

/**
 * A site standing IN the north lake (north-island plan Wave 1). The sea rejection below
 * is `y < seaLevel + 3`, which knows nothing about a lake at 374 u — without this, the
 * scatter plants trees on the carved basin floor and they stand hip-deep in the painted
 * surface. Inside the lake ellipse, dry ground is ground ABOVE the waterline (+1.5 for
 * the trunk flare); the east headland that rises through the disc keeps its trees.
 */
function siteInNorthLake(x, z, y) {
    if (y > ODYSSEY_NORTH_LAKE.waterY + 1.5) return false;
    const lx = (x - ODYSSEY_NORTH_LAKE.x) / ODYSSEY_NORTH_LAKE.rx;
    const lz = (z - ODYSSEY_NORTH_LAKE.z) / ODYSSEY_NORTH_LAKE.rz;
    return ((lx * lx) + (lz * lz)) <= 1;
}

/**
 * ACT II FOREST — the zoned scatter (forest plan Wave 2).
 *
 * Takes the incumbent `scatterTrees`' proven skeleton and adds the three things the reference
 * research says carry an island: WHICH species stands where, WHAT colour it is there, and HOW
 * MUCH geometry it is allowed at that distance. Everything the incumbent measured its way to
 * is preserved unchanged — the jittered grid (pure random clumps and holes at exactly the
 * scale the eye reads as a mistake), the sea+3 / tree-line / slope rejections, and the 140 u
 * density mask.
 *
 * THE ZONE FIELD is the analytic stand-in for the mechanism The Witness actually used: they
 * abandoned multi-layer blend mapping and painted ONE 2048² colour map over the whole island,
 * because zone-scale gradients are a property of the ISLAND, not of a tree. Here that is an
 * altitude band crossed with a low-frequency patch noise, evaluated on the CPU at scatter time
 * and baked per instance — so hue zoning costs zero GPU and stays an art lever in JS.
 *
 * ⚠️ GROWTH STAGES RIDE THE INSTANCE MATRIX, NOT THE GEOMETRY, and this is the decision that
 * makes the bucketing law satisfiable. A stage is defined as pure height/width multipliers, so
 * building a species at stage S is EXACTLY equivalent to building it at `mature` and scaling
 * by (w, h, w) — every dimension in both builders is a product of a spec field and a stage
 * multiplier. Baking stages into geometry would triple the variant count for no visual
 * difference, and 3 stages × 5 species in one chunk is 15 draws where 1-2 will do. The
 * incumbent already scales non-uniformly per instance for the same reason.
 *
 * WHAT A VARIANT IS: one (species, LOD) pair, bucketed on a grid whose edge depends on the LOD
 * (see FOREST_CHUNK_BY_LOD). The plan's original gate was "at most 2 variants per chunk", but
 * that was only ever a PROXY for the thing that matters — the draw-call budget, which is the
 * One World rebuild's own structural claim (Lane A max 90). Now that the scatter reports its
 * buckets, the budget is measured DIRECTLY, at the stations, and the proxy is retired: the
 * shipped shape is 37 total buckets (the incumbent has 40) and 25-27 visible at p=0.225/0.30/
 * 0.42 against an incumbent ~15. A variant count per chunk is no longer meaningful anyway,
 * because a far "chunk" is a 1,680 u square and five species sharing one is expected.
 */

/** The base chunk edge, the incumbent's — its bounding spheres are tuned to it. */
export const FOREST_CHUNK = 420;

/**
 * Chunk edge BY LOD, in world units.
 *
 * ⚠️ THE DRAW BUDGET IS WHY THIS IS NOT ONE NUMBER. A variant is (species x LOD), so with five
 * species the incumbent's uniform 420 u grid multiplies buckets by however many species share
 * a square — measured 92 total buckets and 42-57 VISIBLE at a station, against an incumbent
 * ~15 and a Lane A ceiling of 90 draws for the ENTIRE world. Chunking is a culling/batching
 * trade, and the right point on it depends on distance: near the rail a small chunk culls
 * precisely and is worth its draw, but a far chunk is never the difference between seeing and
 * not seeing, so it should be as large as the frustum tolerates. Coarsening mid and far is
 * what buys the budget back; the far tier is 73% of the trees at 12-20 triangles each, so what
 * it costs in weaker culling it more than refunds in draws.
 */
export const FOREST_CHUNK_BY_LOD = Object.freeze({
    hero: 420,
    mid: 840,
    far: 1680,
});

/**
 * How possible a species is OUTSIDE its altitude band, relative to inside it. The lever that
 * turns altitude from a gate into a preference — see `bandFit`.
 */
const FOREST_BAND_FLOOR = 0.42;

/**
 * How much an ideal altitude is worth against the region patch, which spans 0..1. At 0.45 a
 * perfectly-sited species carries about a quarter of the decision — enough to shape where
 * stands prefer to sit, not enough to own an altitude outright.
 */
const FOREST_FIT_WEIGHT = 0.45;
/**
 * THE ISLAND HAS TWO SIDES (owner direction, 2026-08-15 — the third and final shape).
 *
 * THE ROAD HERE, because each step was rejected on a picture and each rejection taught the
 * next one something:
 *
 *  1. Autumn AT the waterline (2026-08-14, owner-requested). Correct against the old olive-tan
 *     ground; wrong the moment the ground overhaul put a green meadow under it.
 *  2. Green at the waterline, banded by ALTITUDE. Crisp in its own terms (88% green below
 *     +19 u) and inconsistent in the only view that matters: measured, the green/gold boundary
 *     sat between 70 m and 332 m from the sea depending on local gradient, so a steep headland
 *     wore gold down to the sand. The owner spotted exactly that from 700 u up.
 *  3. Green at the waterline, banded by DISTANCE TO WATER. Consistent — and a belt at a
 *     constant distance from the coast is a ribbon parallel to the shore, i.e. the CONTOUR LINE
 *     this file's own band comment forbids. Wobbling its edges softened the read without
 *     changing its nature. Rejected: "I dont like this belt and contour line".
 *
 * What the references actually do is none of these. The Witness gives PLACES their own
 * palettes — "different locations on the island would have very different color palettes…
 * this would help cement the locations' individual personalities" — so the island is divided
 * into REGIONS, and a species belongs to a region rather than to an offset from a feature. A
 * region has no characteristic width, so it cannot read as a band at any distance or altitude.
 *
 * So: one axis across the island, autumn on one side, green on the other, and the cherry grove
 * sitting on the seam between them. The axis is not arbitrary — it is the screen-right vector
 * of the aerial the owner marked up (world (0.891, -0.455) at p=0.30), and the split constant
 * is the projection of the blossom grove's own measured centroid (x 38, z -573) onto it, so
 * "autumn to the right of the cherry trees" is literally what the arithmetic says.
 */
/** The square the shore field covers — the world bakes use the same extent. */
const SHORE_EXTENT = 9000;
const FOREST_REGION_AXIS = Object.freeze([0.891, -0.455]);
/** Where the seam crosses that axis: the blossom grove's measured centroid projects to 295. */
const FOREST_REGION_SPLIT = 295;
/**
 * How wide the hand-over is. Wide on purpose — a region boundary is a gradient of mixture, not
 * an edge, and the two sides interleave across it the way the reference's zones do.
 */
const FOREST_REGION_FEATHER = 420;
/** The seam wanders, so even a soft boundary never reads as a ruled line. */
const FOREST_REGION_WANDER_CELL = 900;
const FOREST_REGION_WANDER_SALT = 91;
const FOREST_REGION_WANDER_AMP = 300;
/**
 * A short green apron at the water survives from step 2, at a third of its old width. The owner
 * asked for green at the water's edge and that request is not withdrawn by this one; at this
 * width it is a shoreline rather than a belt (invisible as a band from 700 u, where a 330 m one
 * was the whole complaint).
 *
 * It HOLDS to 45 m and then hands over, rather than ramping from zero at the waterline. A linear
 * ramp is weakest exactly where the apron is supposed to be strongest — measured, it let the
 * near-shore green share fall to 79% when the whole point of the term is that the water's edge
 * is green.
 */
/**
 * CLEARINGS. `OPEN` is the threshold above which the canopy stops entirely; `EDGE` is where it
 * starts thinning toward that, so a glade has a feathered treeline instead of a shaved circle.
 * The cell is deliberately large — a clearing you can see across from the air, not a gap between
 * trunks — and the thresholds are MEASURED against the field's own distribution rather than
 * guessed: over the plantable disc this field runs p50 0.510 / p80 0.706 / p88 0.766, so 0.766
 * is the value that opens ~12% of the area. The first guess (0.87) sat past p92 and removed 3%,
 * which is a rounding error, not a clearing.
 */
/**
 * THE ISLAND THINS TOWARD ITS EDGES, AND INTO STANDS (owner direction, 2026-08-15, marked on an
 * editor screenshot: "remove half of the distant autumn trees to the far right… also some trees
 * to the left… work with the composition to get natural forests").
 *
 * Replaces a one-term thin that ran along the region axis. That term could reduce the east, but
 * it could not answer the rest of the brief, because REDUCING and COMPOSING are different jobs:
 * thinning a uniform carpet evenly just produces a sparser uniform carpet. So this is three
 * terms, one per sentence of the brief.
 *
 *  1. RAIL FALLOFF — gentle and symmetric. The journey's surroundings stay dense and the
 *     extremities thin out, which is both what the owner circled at BOTH ends and what a real
 *     forest does at an exposed coast. Reviewed first: the two circled areas measured 1,051 and
 *     1,538 trees and were 100% `far` LOD, i.e. both are defined by being far from the journey.
 *     One falloff in that quantity therefore answers both circles without two hand-carved rules.
 *  2. AUTUMN EXTRA — the east mass is the densest ground on the island AND the half the owner
 *     asked to halve, so it carries an additional term on the region axis. Symmetric thinning
 *     alone gave the opposite balance to the brief (-66% west against -29% east), because west
 *     trees are simply further from the rail.
 *  3. STANDS — a smooth field that decides WHERE the removal falls: hard between groves, gentle
 *     inside them, so the far island becomes woods with open ground between rather than thinner
 *     confetti.
 *
 * ⚠️ THE STAND TERM IS MEAN-PRESERVING, and that is the whole trick. Its factor averages to 1
 * over the field, so the distance terms alone decide HOW MANY trees go and the stand field
 * decides only WHICH. The first cut multiplied by a factor whose mean was 0.35 and silently
 * cancelled two thirds of the reduction it was meant to be shaping — the east came out at -0%
 * while the arithmetic said -28%.
 *
 * ⚠️ AND THE STAND CELL MUST REPEAT WITHIN THE REGIONS IT MODULATES. The first cut used 780-900 u
 * cells; the east mass spans barely one of those, so across that whole area the "field" was a
 * single constant that happened to be high, and it spared everything. A field that does not
 * repeat inside the area it shapes is not a field, it is a coin flip.
 *
 * MEASURED at these values: the east mass the owner asked to halve is down **52%** and the west
 * green end **26%** ("some"), the island goes 7,672 -> 6,442, and hero+mid is untouched at 2,173
 * of 2,174 — the near-camera forest the player actually walks through is not part of this at all.
 *
 * ⚠️ AND THE MAPLE'S POPULATION IS DEFENDED BY ITS WEIGHT, NOT BY AN EXEMPTION HERE. The autumn
 * side carries the extra thin, so a density operation aimed at the gold MASS cut the
 * owner-requested red maple to 46 trees island-wide. Exempting it was tried first and distorted
 * exactly what it was meant to protect — the maple survived everything and went from 14% of the
 * east to 37% of it. Thinning decides HOW MANY trees stand somewhere; the species weights decide
 * WHICH they are. Each lever keeps its own job (maple weight 0.55 -> 0.95, now 434 island-wide).
 */
const FOREST_THIN_RAIL_NEAR = 520;
const FOREST_THIN_RAIL_FAR = 1450;
const FOREST_THIN_RAIL_MAX = 0.30;
/** The autumn side's extra, applied only where it is already far from the journey. */
const FOREST_THIN_AUTUMN_MAX = 1.60;
const FOREST_THIN_AUTUMN_SPAN = 700;
/** Grove scale. Small enough to repeat many times inside the east and west masses. */
const FOREST_THIN_STAND_CELL = 300;
const FOREST_THIN_STAND_SALT = 71;
/** How strongly stands redistribute the removal. 0 = even thinning, 1 = groves and gaps. */
const FOREST_THIN_STAND_BITE = 0.90;
const FOREST_GLADE_CELL = 620;
const FOREST_GLADE_SALT = 137;
const FOREST_GLADE_EDGE = 0.68;
const FOREST_GLADE_OPEN = 0.766;

/**
 * THE ARCHIPELAGO (owner direction, 2026-08-15: "we can reduce a bigger amount of trees, we
 * just need to have the composition and the placement feel right").
 *
 * The island stops being a carpet with regional colour and becomes an archipelago of big
 * closed stands with real meadows between them. This is a CARVE, not a dilution: interior
 * stand density is untouched (in-stand nearest-neighbour p50 moves 11.1 -> 11.2 u) while the
 * count falls 26% -- the removal all lands in shaped voids. Three parts, evaluated per site in
 * archKeep() below, in this order:
 *
 *   SET-PIECES  Authored shapes that override everything else, because a composition needs
 *               moments and a field cannot author a moment: a hero meadow the ch4 rail skirts
 *               (with one witness broadleaf standing alone in it), a lone-tree hill, and two
 *               gold-finger meadows that interlock the north seam so the colour boundary
 *               reads as bays and peninsulas instead of a front.
 *   POOL GATE   The near field never carves: per-tree rail distance <= 520, else fine-chunk
 *               centre distance <= 520 -- which is EXACTLY the non-far LOD set (0 mismatches
 *               measured), and tier-invariant because every tier row keeps mid === 520 (a
 *               contract test pins this; hero varies per tier and must not key the SET).
 *   WOODS       A two-octave patch field with a per-area HARD threshold: above it forest,
 *               below it meadow, a feathered treeline rim on the woods side and a sparse
 *               pioneer fringe (P_SINGLE) just past the edge on the open side.
 *
 * !! THE THRESHOLDS ARE FROZEN PERCENTILES, NOT TUNABLES -- and that is how the rate stays
 * exact. Each area's threshold was calibrated offline as the (1 - kill)-quantile of the woods
 * field over that area's own eligible pool, so the kill fraction is exact BY CONSTRUCTION and
 * the mean-preservation trap (a modulation factor that silently changes the rate -- this file
 * has shipped that bug once already; see the stand-bite note) structurally cannot occur.
 * The cost is a calibration dependency: the numbers below are quantiles of the CURRENT
 * terrain and the CURRENT upstream pipeline (density mask, three-term thin, glade, every salt
 * above). Changing ANY of those, or any FOREST_ARCH constant, requires re-emitting this table
 * via the sim that authored it -- one run prints it:
 *     node <scratchpad>/painter-arch.mjs   (kept with the plan; prints "thresholds: {...}")
 * Do not hand-tune a threshold: a hand-tuned quantile is just a number that used to be true.
 *
 * The kill fractions that produced these thresholds are the owner's density dial per area
 * (RAIL 0 / SEAM 0.22 / ETIP 0.44 / EMASS 0.42 / NE 0.60 / NW 0.48 / WEND 0.42 / WMID 0.40).
 * "Reduce more later" = raise fractions, re-run the sim, transcribe the new table, and check
 * the nested-subset property (a deeper cut removes a superset -- measured 0 violations).
 *
 * MEASURED (2026-08-15, digit-for-digit against the shipped implementation): shipped
 * 6,442 -> 4,739 (-26.4%), composition 8,952 -> 5,974, hero+mid 2,173 -> 2,002, draws 34 -> 34,
 * 120 u-cell density contrast p90/p50 1.71 -> 2.35, >=55 u meadow gaps 7 -> 20, apron 99%
 * green, maple 251 / cypress 188 / blossom 110 shipped. Salts 47/53/61/67/73 are new; the
 * ledger of taken salts lives with the sim.
 */
const FOREST_ARCH_SALT_WOODS_A = 47;
const FOREST_ARCH_SALT_WOODS_B = 53;
const FOREST_ARCH_SALT_RIM = 61;
const FOREST_ARCH_SALT_SINGLE = 67;
const FOREST_ARCH_SALT_SETPIECE = 73;
const FOREST_ARCH_OCT_A = 0.62;
const FOREST_ARCH_OCT_B = 0.38;
const FOREST_ARCH_CELL_B = 190;
/** Field-units of feathered treeline below each threshold (extra kills, ramped). */
const FOREST_ARCH_RIM = 0.05;
/** Field-units past the threshold where pioneer singles may stand, and their survival rate. */
const FOREST_ARCH_SINGLE_BAND = 0.055;
const FOREST_ARCH_P_SINGLE = 0.16;
/** The near field the carve never touches -- see the pool-gate note in the header. */
const FOREST_ARCH_POOL_RAIL_D = 520;
/** Per-area woods-field cell size (WEND is the small-stand end of the island). */
const FOREST_ARCH_AREA = Object.freeze({
    RAIL: Object.freeze({ cellA: 430 }),
    SEAM: Object.freeze({ cellA: 430 }),
    ETIP: Object.freeze({ cellA: 430 }),
    EMASS: Object.freeze({ cellA: 430 }),
    NE: Object.freeze({ cellA: 430 }),
    NW: Object.freeze({ cellA: 430 }),
    WEND: Object.freeze({ cellA: 280 }),
    WMID: Object.freeze({ cellA: 430 }),
});
/**
 * FROZEN quantiles -- never recompute at runtime, never hand-tune. See the header.
 * Full precision on purpose: freezing the sim's 3-decimal PRINTS instead flipped six
 * borderline far-LOD trees (one sat 0.0002 inside the pioneer band with the rounded
 * threshold and outside it with the true quantile) -- a quantile is a boundary, and a
 * boundary transcribed at display precision is a slightly different boundary.
 *
 * RE-EMITTED 2026-08-15 after the broadleaf ceiling, which removes 16 sites UPSTREAM of this
 * stage and therefore changes the pool these are quantiles of. Only SEAM moved (0.5461778 ->
 * 0.5469368) and that is the check that the re-emission was sound rather than noise: every one
 * of the ceiling's 16 trees falls in the SEAM area, so exactly one threshold had any reason to
 * move. The other seven are byte-identical.
 *
 * RE-EMITTED 2026-08-16 after Wave 1C (the massif flyby re-map). The rail's 48 p-samples all
 * re-seated on the longer curve and the massif footY datum moved 0.0556u, so every area's
 * eligible pool changed and ALL seven thresholds moved. Transcribed at full precision from
 * scripts/act2-forest-arch-calibrate.mjs, per the header's law.
 *
 * RE-EMITTED AGAIN 2026-08-16 for the north lake (north-island plan Wave 1): the basin +
 * lake exclusion removes NW/NE/SEAM pool sites, so exactly those three thresholds moved —
 * the other four are byte-identical, which is the check the re-emission was sound.
 */
const FOREST_ARCH_T_BY_AREA = Object.freeze({
    RAIL: Infinity,
    SEAM: 0.5847260989174075,
    ETIP: 0.6269598341870908,
    EMASS: 0.8244496408416748,
    NE: 0.45171214783398395,
    NW: 0.43436810246721713,
    WEND: 0.5732750837682767,
    WMID: 0.5042125928823078,
});
/** The ch4 hero meadow: an ellipse in the rail's frame, core empty, rim feathered. */
const FOREST_ARCH_MEADOW = Object.freeze({
    cx: -432, cz: -277, ux: -0.25, uz: -0.97, a: 190, b: 130, core: 0.72,
});
/** One mature shore broadleaf stands alone in the meadow -- snapped to a real placement. */
const FOREST_ARCH_WITNESS = Object.freeze({ x: -468.7, z: -418.4, keepR: 10 });
const FOREST_ARCH_LONE = Object.freeze({
    cx: -997.3, cz: -884.4, r: 110, keepR: 14,
});
/** Two meadow bites that interlock the seam: one from the green side, one from the gold. */
const FOREST_ARCH_FINGERS = Object.freeze([
    Object.freeze({ cx: -536, cz: -1412, r: 150 }),
    Object.freeze({ cx: -395, cz: -1708, r: 140 }),
]);
/** The cypress grove is punctuation; the carve must not eat the black notes. */
const FOREST_ARCH_CYPRESS = Object.freeze({ cx: -1086, cz: -1753, r: 240 });
/**
 * The autumn shore TERRACE: autumnBoost pays where region AND apron are high, i.e. one
 * terrace above the green apron (shore 45..200 u). Protected so the owner's red-maple run
 * and the gold shoreline stay a continuous painted band under the finale camera.
 */
const FOREST_ARCH_TERRACE = Object.freeze({
    region: 0.55, shoreLo: 45, shoreHi: 200, zMin: -1400,
});

/** The two-octave woods field the thresholds are quantiles OF. */
function forestWoodsAt(x, z, cellA) {
    return (FOREST_ARCH_OCT_A * patchNoise(x, z, cellA, FOREST_ARCH_SALT_WOODS_A))
        + (FOREST_ARCH_OCT_B * patchNoise(x, z, FOREST_ARCH_CELL_B, FOREST_ARCH_SALT_WOODS_B));
}

/**
 * Which named area is this site in? Ruled boundaries, deliberately: the thresholds were
 * calibrated per THESE areas, so a wobbled boundary needs a re-emitted table (the plan holds
 * a salt-79 wobble in reserve if the aerial shows the seams).
 */
function forestAreaOf(x, z, dRail) {
    if (dRail <= FOREST_ARCH_POOL_RAIL_D) return 'RAIL';
    const along = (x * FOREST_REGION_AXIS[0]) + (z * FOREST_REGION_AXIS[1]);
    if (z < -1500) return along > FOREST_REGION_SPLIT ? 'NE' : 'NW';
    if (x > 700) return 'ETIP';
    if (along > FOREST_REGION_SPLIT + 420) return 'EMASS';
    if (Math.abs(along - FOREST_REGION_SPLIT) <= 420) return 'SEAM';
    if (x < -1200) return 'WEND';
    return 'WMID';
}

/**
 * The archipelago predicate. Order matters and is the sim's, verified digit-for-digit:
 * set-pieces override the pool gate (the hero meadow lives ON the rail corridor), the pool
 * gate overrides the woods field, exemptions sit between them. Reads only (x, z) and fields --
 * never speciesId or lod -- so filtering the final placements array is exactly equivalent to
 * this in-loop rejection (every downstream mechanism is site-local; the call site's
 * !spec.grove guard is the blossom exemption, matching the glade's own idiom).
 */
function archKeep(x, z, dRail, shoreDist, rail) {
    const rx = Math.round(x);
    const rz = Math.round(z);
    {
        const dd = Math.hypot(x - FOREST_ARCH_LONE.cx, z - FOREST_ARCH_LONE.cz);
        if (dd < FOREST_ARCH_LONE.keepR) return true;
        if (dd < FOREST_ARCH_LONE.r * 0.8) return false;
        if (dd < FOREST_ARCH_LONE.r) {
            const rim = (dd - (FOREST_ARCH_LONE.r * 0.8)) / (FOREST_ARCH_LONE.r * 0.2);
            if (hash2(rx, rz, FOREST_ARCH_SALT_SETPIECE) > ((rim * 0.9) + 0.1)) return false;
        }
    }
    {
        const px = x - FOREST_ARCH_MEADOW.cx;
        const pz = z - FOREST_ARCH_MEADOW.cz;
        const lu = ((px * FOREST_ARCH_MEADOW.ux) + (pz * FOREST_ARCH_MEADOW.uz))
            / FOREST_ARCH_MEADOW.a;
        const lv = ((px * -FOREST_ARCH_MEADOW.uz) + (pz * FOREST_ARCH_MEADOW.ux))
            / FOREST_ARCH_MEADOW.b;
        const e = Math.sqrt((lu * lu) + (lv * lv));
        if (e < 1) {
            const wd = Math.hypot(x - FOREST_ARCH_WITNESS.x, z - FOREST_ARCH_WITNESS.z);
            if (wd < FOREST_ARCH_WITNESS.keepR) return true;
            if (e < FOREST_ARCH_MEADOW.core) return false;
            const rim = (e - FOREST_ARCH_MEADOW.core) / (1 - FOREST_ARCH_MEADOW.core);
            if (hash2(rx, rz, FOREST_ARCH_SALT_SETPIECE) > ((rim * 0.85) + 0.15)) return false;
        }
    }
    for (let f = 0; f < FOREST_ARCH_FINGERS.length; f += 1) {
        const fin = FOREST_ARCH_FINGERS[f];
        const dd = Math.hypot(x - fin.cx, z - fin.cz);
        if (dd < fin.r * 0.75) return false;
        if (dd < fin.r) {
            const rim = (dd - (fin.r * 0.75)) / (fin.r * 0.25);
            if (hash2(rx, rz, FOREST_ARCH_SALT_SETPIECE) > ((rim * 0.85) + 0.15)) return false;
        }
    }
    if (dRail <= FOREST_ARCH_POOL_RAIL_D) return true;
    if (rail.length) {
        const ccx = (Math.floor(x / FOREST_CHUNK) + 0.5) * FOREST_CHUNK;
        const ccz = (Math.floor(z / FOREST_CHUNK) + 0.5) * FOREST_CHUNK;
        if (railDist2(ccx, ccz, rail)
            <= FOREST_ARCH_POOL_RAIL_D * FOREST_ARCH_POOL_RAIL_D) return true;
    }
    if (Math.hypot(x - FOREST_ARCH_CYPRESS.cx, z - FOREST_ARCH_CYPRESS.cz)
        < FOREST_ARCH_CYPRESS.r) return true;
    if (forestRegionAt(x, z) > FOREST_ARCH_TERRACE.region && z > FOREST_ARCH_TERRACE.zMin
        && shoreDist >= FOREST_ARCH_TERRACE.shoreLo
        && shoreDist < FOREST_ARCH_TERRACE.shoreHi) return true;
    const area = forestAreaOf(x, z, dRail);
    const T = FOREST_ARCH_T_BY_AREA[area];
    if (!Number.isFinite(T)) return true;
    const W = forestWoodsAt(x, z, FOREST_ARCH_AREA[area].cellA);
    if (W > T + FOREST_ARCH_SINGLE_BAND) return false;
    if (W > T) return hash2(rx, rz, FOREST_ARCH_SALT_SINGLE) < FOREST_ARCH_P_SINGLE;
    if (W > T - FOREST_ARCH_RIM) {
        const rim = (W - (T - FOREST_ARCH_RIM)) / FOREST_ARCH_RIM;
        if (hash2(rx, rz, FOREST_ARCH_SALT_RIM) < rim * 0.8) return false;
    }
    return true;
}
const FOREST_SHORE_GREEN = 45;
const FOREST_SHORE_FADE = 95;
/**
 * How hard the autumn side is autumn — swept, not picked. Measured right-side green share at
 * each value: 0.42 -> 1% (a birch monoculture that also drove the island's pine from 22% to 5%),
 * 0.30 -> 16%, 0.24 -> 26%, 0.18 -> 37%. 0.24 gives a side that unmistakably reads autumn
 * (66% gold birch) while keeping a quarter of it dark conifer, which is what the reference's
 * autumn area does too — the golds read BECAUSE something dark is standing in them.
 */
const FOREST_AUTUMN_BOOST = 0.24;

/**
 * DISTANCE TO THE WATERLINE, in metres, as a sampled field.
 *
 * A two-pass chamfer transform over a coarse land mask. Coarse on purpose: the band edges are
 * 120 m and 330 m, so 23 u texels put a dozen texels across the narrowest feature, and the
 * mask costs one height lookup per texel rather than the marching a true geodesic needs.
 *
 * Chamfer weights 5/7 (the classic integer approximation of 1 and sqrt(2), scaled by 5) keep
 * diagonal distance honest to ~2%; a naive 1/1 city-block transform would make the band
 * diamond-shaped around headlands, which is the same class of artefact as banding by height.
 */
export function buildShoreDistance(heightAt, seaLevel, res = 384) {
    // The same square the world bakes span; the island sits well inside it.
    const step = SHORE_EXTENT / res;
    const origin = -SHORE_EXTENT / 2;
    const BIG = 1e9;
    const d = new Float32Array(res * res);
    for (let j = 0; j < res; j += 1) {
        const z = origin + (j * step);
        for (let i = 0; i < res; i += 1) {
            d[(j * res) + i] = heightAt(origin + (i * step), z) > seaLevel ? BIG : 0;
        }
    }
    const N = 5;
    const D = 7;
    const at = (i, j) => ((i < 0 || j < 0 || i >= res || j >= res) ? BIG : d[(j * res) + i]);
    for (let j = 0; j < res; j += 1) {
        for (let i = 0; i < res; i += 1) {
            const k = (j * res) + i;
            d[k] = Math.min(
                d[k],
                at(i - 1, j) + N,
                at(i, j - 1) + N,
                at(i - 1, j - 1) + D,
                at(i + 1, j - 1) + D,
            );
        }
    }
    for (let j = res - 1; j >= 0; j -= 1) {
        for (let i = res - 1; i >= 0; i -= 1) {
            const k = (j * res) + i;
            d[k] = Math.min(
                d[k],
                at(i + 1, j) + N,
                at(i, j + 1) + N,
                at(i + 1, j + 1) + D,
                at(i - 1, j + 1) + D,
            );
        }
    }
    const scale = step / N;
    return (x, z) => {
        const gx = Math.max(0, Math.min(res - 1.001, (x - origin) / step));
        const gz = Math.max(0, Math.min(res - 1.001, (z - origin) / step));
        const i0 = Math.floor(gx);
        const j0 = Math.floor(gz);
        const fx = gx - i0;
        const fz = gz - j0;
        const i1 = Math.min(res - 1, i0 + 1);
        const j1 = Math.min(res - 1, j0 + 1);
        const a = d[(j0 * res) + i0];
        const b = d[(j0 * res) + i1];
        const c = d[(j1 * res) + i0];
        const e = d[(j1 * res) + i1];
        return ((((a * (1 - fx)) + (b * fx)) * (1 - fz)) + (((c * (1 - fx)) + (e * fx)) * fz)) * scale;
    };
}

/**
 * Exponent skewing each tree's position on its species' hue ramp toward the `crown` end.
 * 1 would spread trees evenly; 1.7 keeps the far end (the reds, the deep olives) a minority
 * accent, which is how the reference grove is composed — gold dominant, red punctuating.
 */
const FOREST_HUE_SKEW = 1.7;

/** Deterministic integer hash, the incumbent's, so placements stay reproducible. */
function hash2(i, j, salt) {
    let h = ((i | 0) * 374761393) + ((j | 0) * 668265263) + (salt * 2654435761);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise on a coarse lattice — the zone patches. */
function patchNoise(x, z, cell, salt) {
    const gx = x / cell;
    const gz = z / cell;
    const i0 = Math.floor(gx);
    const j0 = Math.floor(gz);
    const fx = gx - i0;
    const fz = gz - j0;
    const sx = fx * fx * (3 - (2 * fx));
    const sz = fz * fz * (3 - (2 * fz));
    const a = hash2(i0, j0, salt);
    const b = hash2(i0 + 1, j0, salt);
    const c = hash2(i0, j0 + 1, salt);
    const d = hash2(i0 + 1, j0 + 1, salt);
    return ((a * (1 - sx)) + (b * sx)) * (1 - sz) + (((c * (1 - sx)) + (d * sx)) * sz);
}

/**
 * How well a species suits this altitude, in [0,1].
 *
 * A band is a soft window, not a hard cut: a hard altitude boundary draws a CONTOUR LINE
 * across the island in species, which is the one thing a zone boundary must never look like.
 */
/**
 * THE BROADLEAF CEILING (owner-reported, 2026-08-15, circled on three editor screenshots:
 * "remove these lod trees fully to the left that is not a spruces... a bit high on the
 * mountain").
 *
 * FOREST_BAND_FLOOR below is deliberately generous — altitude should modulate rather than
 * dictate, and that floor is what stopped the journey running 100% one species. But a floor
 * that never reaches zero lets a species win ANYWHERE its patch field is strong, however
 * absurd the altitude, and the owner found where that lands: thirteen SHORE broadleaf standing
 * at y=483..515 on the massif's west shoulder, 190 m above their own 288..325 band, reading as
 * flat green plates on an alpine face. Above y=420 the leaf trees actually OUTNUMBERED the
 * conifers (22 to 20) — on a mountain.
 *
 * Conifers are deliberately NOT ceilinged. A fir on a high ridge IS the treeline, the
 * subalpine fir legitimately reaches y=613 up there, and keeping it is the owner's own
 * criterion ("that is not a spruces"). So this is a BUILDER rule, not an altitude rule: it
 * encodes the distinction the owner drew by eye, which is between kinds of tree rather than
 * between heights.
 *
 * The blossom grove is exempt — the same exemption it already holds from the glade and the
 * archipelago carve. It is the authored showpiece, its high trees are hero-LOD beside the
 * rail, and the owner circled the far green clump three times and never the pink one.
 */
const FOREST_BROADLEAF_CEILING = 95;

function bandFit(species, y) {
    const band = FOREST_BANDS[species.band];
    if (!band) return 0;
    const mid = (band.lo + band.hi) / 2;
    const half = Math.max(1e-3, (band.hi - band.lo) / 2);
    // Feathered by a full half-width on each side, so neighbouring bands overlap and trade.
    const t = Math.abs(y - mid) / (half * 2);
    const fit = Math.max(0, 1 - (t * t));
    // ⚠️ A FLOOR, SO ALTITUDE MODULATES RATHER THAN DICTATES. With a hard zero outside its
    // band, a species simply cannot appear there however strong its region patch is — and
    // measuring the journey showed what that costs: the hero tier came out 81% ONE species,
    // and from p=0.28 to p=0.42 the near field was 100% shore broadleaf. The player walks
    // past a five-species roster and sees one tree.
    //
    // The reference island is the corrective. The Witness zones are REGIONAL, not altitudinal
    // — ref3 has mustard, pink, cypress and deep-green stands side by side at much the same
    // height. Altitude should say "firs prefer it up here", not "nothing else may grow here".
    return FOREST_BAND_FLOOR + ((1 - FOREST_BAND_FLOOR) * fit);
}

/**
 * Which side of the island is this? 0 = the green west, 1 = the autumn east, seamed at the
 * cherry grove with a wandering boundary. ONE definition, shared by pickSpecies (which paints
 * with it) and the archipelago stage (whose shore terrace protects with it) — the two must
 * never disagree about where the autumn side begins.
 */
function forestRegionAt(x, z) {
    const wander = (patchNoise(x, z, FOREST_REGION_WANDER_CELL, FOREST_REGION_WANDER_SALT)
        - 0.5) * FOREST_REGION_WANDER_AMP;
    const along = (x * FOREST_REGION_AXIS[0]) + (z * FOREST_REGION_AXIS[1]);
    return Math.max(0, Math.min(
        1,
        ((along - (FOREST_REGION_SPLIT + wander)) / FOREST_REGION_FEATHER) + 0.5,
    ));
}

/**
 * Pick a species for a site. The zone patch is what makes stands rather than confetti: it
 * varies over ~500 u, i.e. several canopy diameters, which is the width §1b R5 measured on the
 * reference island (2-10 canopy diameters per zone).
 */
function pickSpecies(x, y, z, species, zoneCell, shoreDist) {
    let best = null;
    let bestScore = -Infinity;
    for (let i = 0; i < species.length; i += 1) {
        const s = species[i];
        const fit = bandFit(s, y);
        if (fit <= 0) continue;
        // Each species gets its OWN patch field (salted by index), so their stands interleave
        // instead of tiling the same lattice in lockstep.
        const patch = patchNoise(x, z, zoneCell, 17 + (i * 7));
        // ⚠️ WEIGHT IS AN ADDITIVE BIAS, NOT A MULTIPLIER. Multiplying the score by a 0.18
        // weight does not make a species rare — it makes it IMPOSSIBLE, because it can never
        // out-score a weight-1.0 neighbour anywhere, at any patch value. The first cut did
        // exactly that and the cypress (the anchor species, the composition's black notes)
        // never appeared on the island at all while its table entry looked perfectly correct.
        // As a bias it still loses almost everywhere, but wins in its band's core — which is
        // what "rare" has to mean spatially.
        // THE BLACK-NOTE CLAUSE. The anchor species fell to ~2% of the island after the
        // regional rebalance — the additive weight bias that keeps it from flooding also keeps
        // it from ever winning. But an anchor is PUNCTUATION: ref3's near-black cypress row
        // against luma-137 sand (8:1) is a large part of why that island reads, and 2% spread
        // thin is no punctuation at all. So the anchor gets a concentrated boost INSIDE the
        // top slice of its own patch field: rare almost everywhere, decisive in a few tight
        // stands — rows and clusters, the way the reference plants them.
        const anchorBoost = (s.role === 'anchor' && patch > 0.78) ? 0.85 : 0;
        // The autumn body: gold birch and red maple outbid the greens for one terrace above
        // the water, and nowhere else. See FOREST_AUTUMN_LO for the two mechanisms that were
        // tried first and what each of them measured.
        // WHICH SIDE OF THE ISLAND IS THIS? A smooth regional gradient, seam wandering, with
        // the short green apron at the water as the one remaining distance term.
        const region = forestRegionAt(x, z);
        const apronT = Math.max(0, Math.min(
            1,
            (shoreDist - FOREST_SHORE_GREEN) / (FOREST_SHORE_FADE - FOREST_SHORE_GREEN),
        ));
        const apron = apronT * apronT * (3 - (2 * apronT));
        // `autumnGain` lets one species lean on the region harder than the others (the red
        // maple does; see its entry). Region-shaped, so it cannot leak onto the green side the
        // way a raised `weight` did — and because it is multiplied by `apron` like every autumn
        // term, a species that leans hard on the region leans AWAY from the water for free.
        //
        // A shore PENALTY was built here first, when the maple was being defended by its global
        // weight and was winning the waterline on band fit alone. Measured out at 98% green with
        // the penalty removed against 99% with it: once the maple's advantage became regional,
        // the penalty had nothing left to push against, so it is gone rather than left standing
        // as a tuned-looking constant that no longer does anything.
        const autumnBoost = s.autumnBand
            ? FOREST_AUTUMN_BOOST * (s.autumnGain || 1) * region * apron
            : 0;
        // THE GROVE CLAUSE (D4): same shape as the anchor's — rare almost everywhere,
        // decisive inside the top slice of its own patch — but stronger, because a blossom
        // grove is a DESTINATION: five trees of pink scattered thin is noise, a grove you
        // walk into is the reference's showpiece.
        const groveBoost = (s.grove && patch > 0.82) ? 1.05 : 0;
        // ⚠️ ADDITIVE, NOT MULTIPLICATIVE — and this is the third attempt at the same idea.
        // While `fit` MULTIPLIED the whole score, an in-band species out-scored an out-of-band
        // one at every patch value that mattered, so altitude still decided and the journey
        // still ran 100% shore-broadleaf from p=0.28 to p=0.42. Adding a floor did not fix it
        // because the multiply was the problem, not the floor's height.
        //
        // As a SUM, the region patch carries the decision and altitude is a bonus worth about
        // a quarter of it: firs prefer the heights without forbidding anything else there. The
        // reference island works the same way — its zones are regions, not contour lines.
        const score = patch + (fit * FOREST_FIT_WEIGHT) + ((s.weight - 1) * 0.35)
            + anchorBoost + autumnBoost + groveBoost;
        if (score > bestScore) { bestScore = score; best = s; }
    }
    return best;
}

/** Growth stage from the species' own frequency distribution. */
function pickStage(species, r) {
    let acc = 0;
    for (let i = 0; i < species.stages.length; i += 1) {
        acc += species.stages[i].freq;
        if (r <= acc) return species.stages[i];
    }
    return species.stages[species.stages.length - 1];
}

/** Squared distance from a site to the nearest sampled rail point, in the XZ plane. */
/** Clamp to [0, 1] — used by the thinning terms below. */
function clamp01(v) {
    return Math.max(0, Math.min(1, v));
}

function railDist2(x, z, rail) {
    let best = Infinity;
    for (let i = 0; i < rail.length; i += 1) {
        const dx = x - rail[i].x;
        const dz = z - rail[i].z;
        const d = (dx * dx) + (dz * dz);
        if (d < best) best = d;
    }
    return best;
}

/**
 * The measured shade law, applied on the CPU so the material never has to know a species.
 *
 * §1b R3: shade goes DEEPER and MORE SATURATED along the canopy's own hue axis. Encoding it
 * here — as a saturation gain about the colour's own luma, times a value ratio — means every
 * instance carries a correct shade colour by construction, and no future palette edit can
 * reintroduce a cool or grey shadow by hand-authoring one.
 */
export function shadeColourFor(crown, role) {
    const recipe = FOREST_VALUE_ROLES[role] ?? FOREST_VALUE_ROLES.workhorse;
    const luma = (0.2126 * crown[0]) + (0.7152 * crown[1]) + (0.0722 * crown[2]);
    // ⚠️ BLUE IS NEVER AMPLIFIED, and the blossom is why. The gain pushes each channel away
    // from luma; for foliage that deepens the hue exactly as §1b R3 measured, because green
    // and gold keep blue BELOW luma. Pink does not — its blue sits above luma, so a uniform
    // gain pushed blue UP and the derived shade drifted violet, where every measured pink in
    // the references shades toward ROSE (R up, B flat-to-down; ΔnormB was negative in 14 of
    // 15 pairs INCLUDING the pinks). Capping blue's gain at 1 keeps the law true for every
    // hue the roster can ever hold: saturation rises, blue never does.
    const shade = crown.map((c, i) => {
        // Directional, not flat: when blue is BELOW luma (all foliage) the full gain deepens
        // it exactly as before; only when blue is ABOVE luma (pink) is its gain capped — a
        // first cut capped it in both directions and greens' normB started RISING, because
        // holding B still while R falls moves the ratio the wrong way.
        const gain = (i === 2 && c > luma) ? Math.min(recipe.sat, 1) : recipe.sat;
        return Math.max(0, luma + ((c - luma) * gain));
    });
    // The ONE-OWNER law, enforced by construction rather than approximated: whatever the hue
    // work above did to luma (the blue cap shifts it slightly on pink), the final scale puts
    // the shade's luma at EXACTLY crown luma × role.value. Chromaticity is the map's job;
    // the ratio is this line's.
    const shadeLuma = (0.2126 * shade[0]) + (0.7152 * shade[1]) + (0.0722 * shade[2]);
    const scale = shadeLuma > 1e-6 ? (luma * recipe.value) / shadeLuma : recipe.value;
    return shade.map((c) => c * scale);
}

/**
 * Scatter the zoned forest.
 *
 * @param {(x:number,z:number)=>number} heightAt the CPU height mirror — the same surface the
 *   vertex shader displaces to, so a floating or buried tree stays structurally impossible.
 * @param {object} opts
 * @param {Array<{x:number,z:number}>} opts.rail sampled rail points, for LOD binning. Sampled
 *   by the CALLER, exactly as `railSamples` already is: the world deliberately does not know
 *   the path.
 * @returns {{placements: Array, buckets: Map, stats: object}}
 */
export function scatterZonedForest(heightAt, {
    // ADR-0015: one flag from restoration. `?odysseyWorldNoVisCull=1` puts every tree back.
    visibilityCull = true,
    /**
     * The archipelago carve (ADR-0015: one flag from restoration). false is for the
     * CALIBRATION SIM only — scripts/act2-forest-arch-calibrate.mjs must build its quantile
     * pools from the UN-carved population, or a re-run would calibrate on top of the very
     * carve it is calibrating and the thresholds would ratchet.
     */
    archCarve = true,
    /** 'hero' | 'mid' | 'far' — pin every tree to one LOD. Experiment lever; see below. */
    forceLod = null,
    /** { hero, mid } distances for this quality tier — see forestLodDistanceForTier. */
    lodDistance = null,
    cx = -220,
    cz = -620,
    radius = 1750,
    spacing = 15,
    seaLevel = 287.31,
    snowStart = 640,
    // ⚠️ 385, NOT THE 560 THE PLAN ASSUMED. The nominal snow line was chosen against the tree
    // line; the measured distribution puts 97% of the forest below y=396 and essentially
    // nothing above 460, so a 560 onset dusts NOTHING and the gate that checked it passed
    // vacuously on zero instances. This is the same correction the altitude bands needed, for
    // the same reason: the island's plantable ground is not the island's altitude range. The
    // visual role is "the highest stand reads colder", not a literal snow line.
    snowOnset = 385,
    snowFull = 460,
    zoneCell = 900,
    rail = [],
    species = ODYSSEY_FOREST_SPECIES,
    framing = ODYSSEY_FOREST_FRAMING,
} = {}) {
    const placements = [];
    // Built once for the whole scatter: 384² height lookups plus two linear passes, against
    // 15,000 sites that would each otherwise need their own estimate of where the sea is.
    const shoreAt = buildShoreDistance(heightAt, seaLevel);
    const steps = Math.ceil((radius * 2) / spacing);
    // Per-QUALITY-TIER since 2026-08-15: the owner's hero band of 200 measured +1.57 ms p95 on
    // the integrated lane and put that station over its max, so the distance is a tier setting
    // rather than a constant. Defaults to the conservative pair when no tier is supplied.
    const heroD2 = (lodDistance?.hero ?? FOREST_LOD_DISTANCE.hero) ** 2;
    const midD2 = (lodDistance?.mid ?? FOREST_LOD_DISTANCE.mid) ** 2;

    for (let j = 0; j < steps; j += 1) {
        for (let i = 0; i < steps; i += 1) {
            const x = (cx - radius) + (i * spacing) + ((hash2(i, j, 1) - 0.5) * spacing * 0.95);
            const z = (cz - radius) + (j * spacing) + ((hash2(i, j, 2) - 0.5) * spacing * 0.95);
            if (Math.hypot(x - cx, z - cz) > radius) continue;
            const y = heightAt(x, z);
            // The incumbent's rejections, preserved verbatim — each was measured, not guessed.
            if (y < seaLevel + 3 || y > snowStart) continue;
            if (siteInNorthLake(x, z, y)) continue;
            const e = 4;
            const slope = Math.hypot(
                (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e),
                (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e),
            );
            if (slope > 0.62) continue;
            const mask = hash2(Math.floor(x / 140), Math.floor(z / 140), 3);
            const falloff = 1 - Math.max(0, (y - (snowStart - 130)) / 130);
            if (hash2(i, j, 4) > (0.35 + (mask * 0.95)) * Math.max(0.12, falloff)) continue;
            // THE ISLAND THINS TOWARD ITS EDGES, AND INTO STANDS — see FOREST_THIN_RAIL_NEAR
            // for the three terms and the two mistakes that shaped them. Placed BEFORE the
            // species pick so a skipped site costs nothing at all.
            const dRail = rail.length ? Math.sqrt(railDist2(x, z, rail)) : 0;
            const rt = clamp01((dRail - FOREST_THIN_RAIL_NEAR)
                / (FOREST_THIN_RAIL_FAR - FOREST_THIN_RAIL_NEAR));
            const railThin = rt * rt * (3 - (2 * rt)) * FOREST_THIN_RAIL_MAX;
            const alongAxis = (x * FOREST_REGION_AXIS[0]) + (z * FOREST_REGION_AXIS[1]);
            const autumnSide = clamp01((alongAxis - FOREST_REGION_SPLIT) / FOREST_THIN_AUTUMN_SPAN);
            const at = clamp01((dRail - 500) / 900);
            const autumnThin = autumnSide * (at * at * (3 - (2 * at))) * FOREST_THIN_AUTUMN_MAX;
            const standField = patchNoise(x, z, FOREST_THIN_STAND_CELL, FOREST_THIN_STAND_SALT);
            const thin = clamp01((railThin + autumnThin)
                * clamp01(1 + (FOREST_THIN_STAND_BITE * (1 - (2 * standField)))));
            // ACCENT SPECIES ARE EXEMPT, which is why this sits after the species pick.
            // The red maple is owner-requested by name and is scattered island-wide at 3-4%,
            // so a thin aimed at the autumn MASS took it to 47 trees island-wide — deleting a
            // named species as a side effect of reducing a different one. Rare species are
            // punctuation; they are not what "too many trees" ever meant.
            // NO SPECIES EXEMPTION, and it sits BEFORE the species pick on purpose. Exempting
            // rare species from a density operation was tried and distorted the composition it
            // was meant to protect: the red maple survived everything and went from 14% of the
            // east to 37% of it. Thinning decides HOW MANY trees stand here; the species table's
            // weights decide WHICH. Entangling them makes each unable to express its own job —
            // so the maple's population is defended by its weight (see the species table), not
            // by an exception here.
            if (hash2(i, j, 29) < thin) continue;

            /**
             * THE RAIL CANNOT SEE THIS SITE. Act II's camera is pinned to a spline over a fixed
             * height field, so "is a canopy here ever visible" is decidable geometry rather than
             * a guess about where players look — baked offline by scripts/bake-forest-visibility.
             *
             * MEASURED before it shipped: this removes ~44% of the island's trees and changes
             * 0.00% of pixels at four rail stations, worth 0.20 ms p50 on Lane B. Every tree it
             * takes is `far` LOD; it touches 8 trees across the near-camera species.
             *
             * The three ways unseen geometry usually still matters — silhouette, shadow,
             * reflection — were each checked rather than assumed: a canopy that pokes over a
             * ridge counts as VISIBLE (the bake tests at 16 u, taller than any stage), the sun
             * bake marches terrain only so trees cast nothing, and this world has no reflector.
             */
            if (visibilityCull && !railSeesForestSite(x, z)) continue;
            const shoreDistHere = shoreAt(x, z);
            const spec = pickSpecies(x, y, z, species, zoneCell, shoreDistHere);
            if (!spec) continue;
            // THE BROADLEAF CEILING — see the constant. Enforced HERE, on the winner, rather
            // than as a zeroed `bandFit`, and the difference is the whole request: zeroing the
            // fit removes the broadleaf from the contest, so the site is handed to whichever
            // conifer scored next and thirteen misplaced leaf trees quietly become thirteen new
            // firs. That is a substitution; the owner asked for a removal. Dropping the winning
            // site leaves the ground open, which is also what a real treeline does — it thins
            // toward bare rock rather than swapping species at a contour.
            if (spec.builder === 'broadleaf' && !spec.grove
                && y > FOREST_BANDS[spec.band].hi + FOREST_BROADLEAF_CEILING) continue;

            // CLEARINGS — the aerial's most visible difference from the reference island.
            //
            // Ours was a continuous carpet from the air; theirs is broken by open ground and
            // walked lines, and that open ground is a large part of why the reference reads as
            // a PLACE rather than as coverage. The `mask` above thins the canopy evenly, which
            // is not the same thing at all: an evenly thinner forest is still a carpet.
            //
            // A clearing is a HOLE with an edge. One low-frequency field, thresholded hard
            // enough to empty its core and feathered at the rim so the boundary is a treeline
            // rather than a cut. It costs nothing — it removes trees — which is the rare case
            // where the composition fix and the budget move the same way.
            const glade = patchNoise(x, z, FOREST_GLADE_CELL, FOREST_GLADE_SALT);
            if (!spec.grove) {
                if (glade > FOREST_GLADE_OPEN) continue;
                if (glade > FOREST_GLADE_EDGE) {
                    const rim = (glade - FOREST_GLADE_EDGE)
                        / (FOREST_GLADE_OPEN - FOREST_GLADE_EDGE);
                    if (hash2(i, j, 23) < rim) continue;
                }
            }

            // THE ARCHIPELAGO CARVE -- see the FOREST_ARCH header. After the glade so the
            // stage order matches the sim the thresholds were calibrated in; before the
            // stage pick so a carved site costs nothing further. The blossom grove is exempt
            // exactly as it is from the glade; framing trees never enter this loop.
            if (archCarve && !spec.grove && !archKeep(x, z, dRail, shoreDistHere, rail)) continue;

            const stage = pickStage(spec, hash2(i, j, 8));

            // Snow rides the SAME shell as a per-instance amount, not a second mesh: a nested
            // snow shell is what makes a multi-shell tree swim and z-fight against itself
            // under wind (the framing-spruces rule). Only species authored for it take any.
            const snow = spec.snow
                ? Math.max(0, Math.min(1, (y - snowOnset) / Math.max(1, snowFull - snowOnset)))
                : 0;

            // Per-instance VALUE jitter inside the species' own identity — a uniform scale, so
            // the hue is preserved exactly and a tree can never leave its species (§1b R5's
            // "one dominant hue per tree", never a rainbow).
            //
            // ⚠️ WIDENED FROM ±6% TO ±14% ON AN IN-GAME CAPTURE, and the reason is the CAMERA.
            // Every playground shot of this forest is at eye level, where a canopy shows its
            // SIDE and the sun band does the work. The game's camera looks DOWN at the forest,
            // so the dominant surface is the canopy TOP — and on a blob normal field every top
            // faces up, lands in the same lit band, and the whole forest reads as one flat
            // green sheet. Per-tree value is what breaks that up, and it is exactly what the
            // reference island's own aerial view (§1b ref3) shows: a mosaic of near-tones, not
            // a uniform canopy. ±6% was invisible at that angle.
            const jitter = 1 + ((hash2(i, j, 9) - 0.5) * 0.28);
            // PER-TREE HUE, along the species' own authored ramp — the thing a uniform value
            // jitter structurally cannot do (see `crownAlt`). Skewed toward the `crown` end so
            // the far colour stays an accent: at skew 1.7 roughly a fifth of a stand sits past
            // the ramp's midpoint, which is the proportion of reds in the reference grove.
            const hueT = spec.crownAlt ? hash2(i, j, 11) ** FOREST_HUE_SKEW : 0;
            const base = spec.crownAlt
                ? spec.crown.map((c, k) => c + ((spec.crownAlt[k] - c) * hueT))
                : spec.crown;
            const crown = base.map((c) => Math.max(0, c * jitter));

            placements.push({
                x,
                y,
                z,
                speciesId: spec.id,
                stageId: stage.id,
                // Filled in below, per CHUNK — see the LOD note there.
                lod: null,
                // Non-uniform, because a growth stage IS a proportion change (see the header).
                scaleXZ: stage.w,
                scaleY: stage.h,
                rot: hash2(i, j, 6) * Math.PI * 2,
                // Broadleaves lean more than conifers: a tilted pine reads as falling over
                // where a tilted oak reads as grown. Radians, ±.
                leanX: (hash2(i, j, 12) - 0.5) * (spec.builder === 'conifer' ? 0.05 : 0.11),
                leanZ: (hash2(i, j, 13) - 0.5) * (spec.builder === 'conifer' ? 0.05 : 0.11),
                crown,
                shade: shadeColourFor(crown, spec.role),
                snow,
            });
        }
    }

    // ── the framing trees ──
    // Appended AFTER the grid so they cannot be displaced by a rejection: an authored tree
    // stands where it was authored, subject only to the water floor (terrain is authoritative
    // for Y, so a framing site that has sunk below the sea is dropped, not floated).
    framing.forEach((f, fi) => {
        const spec = species.find((sp) => sp.id === f.species);
        if (!spec) return;
        const y = heightAt(f.x, f.z);
        if (y < seaLevel + 3) return;
        if (siteInNorthLake(f.x, f.z, y)) return;
        const stage = spec.stages.find((st) => st.id === 'old') ?? spec.stages[0];
        const jitter = 1 + ((hash2(fi, 977, 9) - 0.5) * 0.10);
        const hueT = spec.crownAlt ? hash2(fi, 977, 11) ** 1.7 : 0;
        const base = spec.crownAlt
            ? spec.crown.map((c, k) => c + ((spec.crownAlt[k] - c) * hueT))
            : spec.crown;
        const crown = base.map((c) => Math.max(0, c * jitter));
        placements.push({
            x: f.x,
            y,
            z: f.z,
            speciesId: spec.id,
            stageId: stage.id,
            lod: null,
            // A shade LARGER than the largest scattered old tree: a framing tree is meant to
            // be the one you remember at that bend.
            scaleXZ: stage.w * 1.18,
            scaleY: stage.h * 1.18,
            rot: hash2(fi, 977, 6) * Math.PI * 2,
            leanX: (hash2(fi, 977, 12) - 0.5) * 0.06,
            leanZ: (hash2(fi, 977, 13) - 0.5) * 0.06,
            crown,
            shade: shadeColourFor(crown, spec.role),
            snow: 0,
            framing: true,
        });
    });

    // ── LOD, ASSIGNED PER CHUNK ──
    // ⚠️ NOT PER TREE. A 420 u chunk straddling an LOD boundary would otherwise contain trees
    // of two tiers, and since a variant is (species x LOD) that doubles the draws for that
    // chunk — measured 5 variants in one chunk and 89 draws against a 64 bound before this.
    // The chunk is the batching unit, so the chunk is what gets a tier. This also makes the
    // module header's claim ("chunks are distance-binned so LOD is constant within a chunk")
    // true, which it was not.
    const chunkLod = new Map();
    placements.forEach((p) => {
        const ck = `${Math.floor(p.x / FOREST_CHUNK)}|${Math.floor(p.z / FOREST_CHUNK)}`;
        if (!chunkLod.has(ck)) {
            const centreX = (Math.floor(p.x / FOREST_CHUNK) + 0.5) * FOREST_CHUNK;
            const centreZ = (Math.floor(p.z / FOREST_CHUNK) + 0.5) * FOREST_CHUNK;
            const d2 = rail.length ? railDist2(centreX, centreZ, rail) : Infinity;
            let tier = 'far';
            if (d2 <= heroD2) tier = 'hero';
            else if (d2 <= midD2) tier = 'mid';
            chunkLod.set(ck, tier);
        }
        // Framing trees are hero REGARDLESS of their chunk's bin — the plan's rule. They all
        // stand within ~30 u of the rail, so in practice this confirms rather than overrides.
        // `forceLod` is an EXPERIMENT LEVER, not a quality setting: it pins every tree to one
        // tier so the look of hero-everywhere can be felt in the real game rather than argued
        // about from a triangle count. It deliberately bypasses the distance bins, so the
        // chunk-size table below reads the forced tier too — which is the point, and also the
        // sting: hero chunks are 420 u against far's 1,680, so forcing hero multiplies the
        // DRAW count as well as the triangles. Projected 2.27 M triangles against a shipped
        // 314 k, i.e. ~18 ms of forest alone on the integrated lane, where the whole frame
        // budget is 10.6. Expect it to be unusable there and fine on a discrete GPU.
        p.lod = forceLod || (p.framing ? 'hero' : chunkLod.get(ck));
    });

    // ── bucketing: one InstancedMesh per (chunk, species, LOD) ──
    const buckets = new Map();
    placements.forEach((p) => {
        // LOD was decided on the FINE grid above; the bucket grid is coarser for the far
        // tiers. Deciding LOD on the coarse grid instead would make a 1,680 u square pick one
        // tier for trees up to 1,188 u apart.
        const edge = FOREST_CHUNK_BY_LOD[p.lod] ?? FOREST_CHUNK;
        const bx = Math.floor(p.x / edge);
        const bz = Math.floor(p.z / edge);
        const chunk = `${bx}|${bz}|${p.lod}`;
        const key = `${chunk}|${p.speciesId}`;
        if (!buckets.has(key)) {
            buckets.set(key, {
                key,
                chunk,
                edge,
                centre: { x: (bx + 0.5) * edge, z: (bz + 0.5) * edge },
                speciesId: p.speciesId,
                lod: p.lod,
                items: [],
            });
        }
        buckets.get(key).items.push(p);
    });

    const perChunk = new Map();
    buckets.forEach((b) => {
        if (!perChunk.has(b.chunk)) perChunk.set(b.chunk, new Set());
        perChunk.get(b.chunk).add(`${b.speciesId}|${b.lod}`);
    });
    let maxVariantsPerChunk = 0;
    perChunk.forEach((v) => { maxVariantsPerChunk = Math.max(maxVariantsPerChunk, v.size); });

    const bySpecies = {};
    const byLod = { hero: 0, mid: 0, far: 0 };
    placements.forEach((p) => {
        bySpecies[p.speciesId] = (bySpecies[p.speciesId] ?? 0) + 1;
        byLod[p.lod] += 1;
    });

    return {
        placements,
        buckets,
        stats: {
            trees: placements.length,
            draws: buckets.size,
            chunks: perChunk.size,
            maxVariantsPerChunk,
            bySpecies,
            byLod,
        },
    };
}
