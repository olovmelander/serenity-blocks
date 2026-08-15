import {
    FOREST_BANDS,
    FOREST_LOD_DISTANCE,
    FOREST_VALUE_ROLES,
    ODYSSEY_FOREST_FRAMING,
    ODYSSEY_FOREST_SPECIES,
} from './odyssey-forest-species.js';
import { railSeesForestSite } from './odyssey-forest-visibility.js';

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
 * THE FAR SIDE THINS OUT (owner direction, 2026-08-15, marked on an aerial).
 *
 * Measured along the same region axis the composition uses: the forest runs from -1218 to 1810,
 * and 26% of every tree on the island sits beyond 1000 — the far right of the marked frame, and
 * the part of the island the RAIL never approaches. That coincidence is the justification: this
 * is the one place where thinning is both a composition call and a free LOD, because nothing
 * here is ever seen closer than an aerial.
 *
 * Progressive rather than a cut-off. A hard edge in density is a line, and this file has spent
 * three iterations learning what lines look like from the air.
 */
const FOREST_FAR_THIN_NEAR = 900;
const FOREST_FAR_THIN_FAR = 1550;
/** How much of the far side is removed at full strength — a third of it survives. */
const FOREST_FAR_THIN_MAX = 0.65;
const FOREST_GLADE_CELL = 620;
const FOREST_GLADE_SALT = 137;
const FOREST_GLADE_EDGE = 0.68;
const FOREST_GLADE_OPEN = 0.766;
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
        const wander = (patchNoise(x, z, FOREST_REGION_WANDER_CELL, FOREST_REGION_WANDER_SALT)
            - 0.5) * FOREST_REGION_WANDER_AMP;
        const along = (x * FOREST_REGION_AXIS[0]) + (z * FOREST_REGION_AXIS[1]);
        const region = Math.max(0, Math.min(
            1,
            ((along - (FOREST_REGION_SPLIT + wander)) / FOREST_REGION_FEATHER) + 0.5,
        ));
        const apronT = Math.max(0, Math.min(
            1,
            (shoreDist - FOREST_SHORE_GREEN) / (FOREST_SHORE_FADE - FOREST_SHORE_GREEN),
        ));
        const apron = apronT * apronT * (3 - (2 * apronT));
        const autumnBoost = s.autumnBand ? FOREST_AUTUMN_BOOST * region * apron : 0;
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
    const heroD2 = FOREST_LOD_DISTANCE.hero ** 2;
    const midD2 = FOREST_LOD_DISTANCE.mid ** 2;

    for (let j = 0; j < steps; j += 1) {
        for (let i = 0; i < steps; i += 1) {
            const x = (cx - radius) + (i * spacing) + ((hash2(i, j, 1) - 0.5) * spacing * 0.95);
            const z = (cz - radius) + (j * spacing) + ((hash2(i, j, 2) - 0.5) * spacing * 0.95);
            if (Math.hypot(x - cx, z - cz) > radius) continue;
            const y = heightAt(x, z);
            // The incumbent's rejections, preserved verbatim — each was measured, not guessed.
            if (y < seaLevel + 3 || y > snowStart) continue;
            const e = 4;
            const slope = Math.hypot(
                (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e),
                (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e),
            );
            if (slope > 0.62) continue;
            const mask = hash2(Math.floor(x / 140), Math.floor(z / 140), 3);
            const falloff = 1 - Math.max(0, (y - (snowStart - 130)) / 130);
            if (hash2(i, j, 4) > (0.35 + (mask * 0.95)) * Math.max(0.12, falloff)) continue;
            // The far side thins with distance along the region axis — see FOREST_FAR_THIN_NEAR.
            // Placed BEFORE the species pick so the skipped sites cost nothing at all.
            const farT = Math.max(0, Math.min(
                1,
                (((x * FOREST_REGION_AXIS[0]) + (z * FOREST_REGION_AXIS[1])) - FOREST_FAR_THIN_NEAR)
                / (FOREST_FAR_THIN_FAR - FOREST_FAR_THIN_NEAR),
            ));
            const farThin = farT * farT * (3 - (2 * farT)) * FOREST_FAR_THIN_MAX;
            if (hash2(i, j, 29) < farThin) continue;
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
            const spec = pickSpecies(x, y, z, species, zoneCell, shoreAt(x, z));
            if (!spec) continue;
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
        p.lod = p.framing ? 'hero' : chunkLod.get(ck);
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
