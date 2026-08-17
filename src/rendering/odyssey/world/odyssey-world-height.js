/**
 * ODYSSEY ACT II — THE WORLD HEIGHT FIELD.
 *
 * One continuous surface from the ocean floor to the summit, replacing the seven independent
 * ground surfaces the shipped build spreads across chapters 2–5 (Ch3's meadow plate and
 * foothill skirt; Ch4's snow disc, cloud deck and three apron planes; Ch5's inherited deck).
 *
 * See docs/ODYSSEY_ONE_WORLD_PLAN_2026-08.md §3.1–§3.2. The structure follows the plan's
 * macro/detail split:
 *
 *   MACRO  — analytic, smooth, closed-form in world position. Full float precision, evaluated
 *            identically in JS and (when ported) in TSL. This is where the landmarks live.
 *   RELIEF — multi-octave ridged noise, baked to a half-float texture. Local only (±150u),
 *            because half-float epsilon at 1000u is ~0.5u and would terrace a gentle slope.
 *
 * THE LANDMARKS ARE TERMS IN THIS FUNCTION, NOT MESHES. That is the whole point: a massif that
 * is a term in the ground cannot z-fight the ground, cannot be crossfaded out of step with it,
 * cannot be seen through, and cannot pop. Every one of those is a bug this branch has shipped a
 * fix for.
 *
 * The four canonical peaks keep their EXACT shipped world positions and crown heights, because
 * the compositions they produce are ones the project has already validated in-game — notably
 * the far-left flank and the Ch4 hero massif silhouette. Those numbers are pinned by tests.
 */

/** Sea level. Ch2's ceiling and Ch3's water surface are the same world plane in the shipped build. */
export const ODYSSEY_SEA_LEVEL = 287.31;

/**
 * THE WORLD'S UNIT SCALE. **1 world unit = 1 metre.**
 *
 * Nobody had ever written this down (Act II plan §7.3), and four separate proposals had already
 * been authored against four different assumptions — absorption coefficients in metres, creature
 * sizes in metres, e-folds in units. Publishing it is not a preference, it is a precondition:
 * every physical coefficient in the water column is meaningless without it.
 *
 * It is fixed at 1 m/u by the geometry that already shipped and is pinned by tests: the open
 * ocean floor sits ODYSSEY_ABYSS_DEPTH = 207 u below the surface, which is an ocean-shelf depth
 * at 1 m/u and an implausible 52 m at 0.25 m/u; and the massifs stand ~500 u above their foot
 * datum, i.e. 500 m peaks.
 *
 * CONSEQUENCE, recorded because it is a real defect and not a rounding error: the Deep Ocean
 * fish are 5.0-11.8 u long, so at this scale **every fish in the chapter is 5-12 m — whale-shark
 * scale**. That is a Wave 3 sizing fix, not a licence to redefine the unit.
 */
export const ODYSSEY_METRES_PER_UNIT = 1;

/**
 * How far the eye sits above the rail point it is following.
 *
 * THE ONE CONTRACT. There were four different answers in the tree (Act II plan Wave 0): the world
 * renderer's `railPoint.y + 16` behind `uSubmerged`, `+16` in the world playground effect, `+8`
 * in the seam-dive playground effect, and the real camera — which does not sit above the rail at
 * all. `computeFollowFrame` pulls the eye BACKWARDS along the tangent by `followDistance`, so on
 * a climbing rail the eye trails BELOW its rail point; measured in chapter 1 the offset is about
 * -11 to -13 u, not +16. Every playground capture taken against the old numbers was therefore a
 * capture of a different scene from the game.
 *
 * This constant is the playgrounds' stand-in for that real offset, so all three agree. MEASURED
 * across the submerged ascent (2026-08-13): the offset is not constant — it runs -22.6 u at
 * p=0.15, -15.6 at p=0.17, -11.5 at p=0.19 and -7.2 at p=0.20, tightening as the rail flattens
 * toward the surface. -16 is the mid of that span, which is why this is a STAND-IN and not a
 * definition. The renderer's own use of it — deciding whether the camera is under water — is
 * corrected in Wave 1 to read the actual eye, which is the only fully correct answer.
 */
export const ODYSSEY_EYE_RAIL_OFFSET_Y = -16;

/**
 * THE BREACH. **The one progress value at which the journey leaves the water.**
 *
 * Three different "the surface" lived in the tree and every one of them was used as if it were
 * the breach. Recomputed from the shipped spline and the real `computeFollowFrame` eye
 * (MEASURED 2026-08-13, bisection to 1e-5, script archived in the Act II plan's provenance):
 *
 * | event                              | p        |
 * |------------------------------------|----------|
 * | the RAIL crosses sea level         | 0.19182  |
 * | **the EYE crosses sea level**      | **0.20023** |
 * | `uSubmerged` (rail + 16) reaches 0 | 0.18141  |
 *
 * The eye is what the player is, so the eye is the breach. The gap between the last two is the
 * defect Wave 1 fixes: the world declares AIR at 0.18141 while the camera stays under until
 * 0.20023 — **0.0188 of progress, 17% of chapter 2 (0.093-0.204), the entire final ascent** —
 * during which it renders an air sky, air aerial perspective, the cloud deck, and switches the
 * rays, motes and fish off while the viewer is still looking through water.
 *
 * Anything staged on the breach — audio release, Snell's window, the meniscus, the colour script
 * handoff — hangs off THIS constant and nothing else.
 */
export const ODYSSEY_BREACH_P = 0.20023;

/** The datum the canonical peaks' feet sit on. */
export const ODYSSEY_MASSIF_FOOT_Y = 297.5556;

/** How deep the open ocean floor sits below sea level, far from the landmass. */
export const ODYSSEY_ABYSS_DEPTH = 207;

/**
 * The canonical peaks, transcribed from shared/canonical-mountain-range.js. `radius` is the
 * shipped `size * MOUNTAIN_DISPLACEMENT.coneRadiusFrac` (0.45), i.e. the footprint the
 * displaced cone actually reaches — not the plane it was drawn on.
 */
export const ODYSSEY_MASSIFS = Object.freeze([
    Object.freeze({
        id: 'hero', x: -182.7, z: -1059.3, radius: 603, height: 720, exponent: 1.7, footY: 297.5556,
    }),
    Object.freeze({
        id: 'left-main', x: -412.7, z: -979.3, radius: 414, height: 360, exponent: 1.6, footY: 297.5556,
    }),
    Object.freeze({
        id: 'right-main', x: 47.3, z: -1009.3, radius: 405, height: 340, exponent: 1.6, footY: 297.5556,
    }),
    // NOTE the different datum: the shipped far-left flank sits 50u lower than the others.
    Object.freeze({
        id: 'far-left', x: -1892.7, z: -1639.3, radius: 675, height: 430, exponent: 1.55, footY: 247.5556,
    }),
]);

/**
 * THE SHORE PROFILE.
 *
 * Not a radial blob — a profile along Z, solved against the altitudes the rail actually flies.
 * The first attempt used a radial landmass centred on the massifs, which put the seabed at 246
 * where the Chapter 2 rail dives to y=128: the camera flew through the ocean floor for the
 * first 49 samples of Act II. The ocean has to be deep where the ocean is.
 *
 * The rail's own numbers are the specification:
 *
 *   z ≈ +8    Ch2 begins, rail y 128   → seabed must sit well below 128
 *   z ≈ -26   the breach, rail y 287   → still open water
 *   z ≈ -250  Ch3, rail y ~320         → the shoreline
 *   z ≈ -420  Ch4 approach, rail y 380 → land
 *   z ≈ -1059 the hero massif          → crown 1017.5
 */
const ABYSS_Y = 80; // ocean floor in the open sea
const SHELF_RISE = 245; // how far the continental shelf climbs to the shore plateau
const SHELF_FROM_Z = 60;
const SHELF_TO_Z = -260;
const INLAND_RISE = 60; // the land keeps climbing toward the peaks
const INLAND_FROM_Z = -300;
const INLAND_TO_Z = -900;
const LAND_X = -220;
const LAND_HALF_WIDTH = 2400;

/**
 * THE NORTH COAST — what makes the landmass an ISLAND instead of a peninsula.
 *
 * Without it, `shelfT` and `inlandT` saturate at 1 past z=-900 and simply STAY there: the
 * ground ran at a constant 385 (97.7 above sea level) for every z from -900 to the lattice
 * horizon at 26 km — measured identical at z=-3000, -9000 and -26214. Worse, the macro bake
 * only covers ±4500 and is ClampToEdge, so the land crossing the plate's northern boundary
 * (7.5% of the boundary was dry) was EXTRUDED another ~21,700 u by the sampler. That is the
 * "infinitely long land stretch behind the mountain" the owner photographed from the layout
 * editor (2026-08-14).
 *
 * The numbers are set by three hard constraints, north to south:
 *   - the rail's northernmost point is z = -743.5 (p=0.831) — the coast must stay far behind it;
 *   - the last massif influence ends at z ≈ -2483 (far-left's footprint + its 1.25x relief
 *     halo), and inside a footprint the pedestal blends against the LOCAL ground, so the
 *     ground must not move there — the taper starts 117 u beyond it;
 *   - the baked plate ends at ±4500 and its edge clamp extrudes whatever value crosses the
 *     boundary to the horizon, so the coast must COMPLETE well inside the plate. Underwater
 *     by z=-3400 leaves 1100 u of margin, and turns the clamp into an ally: a boundary that
 *     is ocean everywhere extrudes OCEAN to the horizon, which is exactly the island-in-a-sea
 *     reading the world wants.
 *
 * Slope check (the clipmap's own continuity bar): the full rise is at most SHELF_RISE +
 * INLAND_RISE = 305 u released over 800 u of z — peak smoothstep slope ≈ 0.57, gentler than
 * the south shelf the rail already flies over.
 */
const NORTH_SHORE_FROM_Z = -2600;
const NORTH_SHORE_TO_Z = -3400;

/** The Ch3 basin — an inland lake bowl, sited past the shoreline rather than in the surf. */
const BASIN_X = -150;
const BASIN_Z = -520;
const BASIN_RX = 430;
const BASIN_RZ = 330;
const BASIN_DEPTH = 42;

/**
 * THE NORTH LAKE (north-island plan Wave 1, owner-directed 2026-08-16). The 1C flyby made
 * the plateau behind the hero massif primary real estate — the climb's bank looks down
 * across it at p ≈ 0.55–0.68 — and the owner marked this shelf for a lake.
 *
 * A COMPACT bowl, not a Gaussian like the Ch3 basin: the world-height suite pins the bare
 * plateau at (−220, −1500) to 0.05 u, and a Gaussian's tail still moves that probe by
 * −1.7 u from 300 u away. This profile is EXACTLY zero at rn ≥ 1 (the closing-taper law
 * the north coast paid for, enforced by construction), so the pin — at rn 1.35 — is
 * untouched by arithmetic, not by tolerance.
 *
 * `waterY` is the painted surface's seat (renderer-side). The floor carves to ~366–374
 * under relief; the rim stays at the plateau's own 384–390, so the waterline is drawn by
 * the DEPTH BUFFER where terrain rises through the disc — an organic shoreline for free,
 * with relief supplying the irregularity.
 */
// waterY 374, not the first draft's 378: the plateau's own west edge sits at ~377, and a
// waterline above it SPILLS — the flat disc would hang past the bowl over lower ground.
// 374 tucks the surface under every rim azimuth (probed at rn 1.05: 36/36 above water).
//
// ⚠️ THE SITE IS OWNER-DIRECTED (2026-08-16, from the capture frames): "the lake on the
// edge of the orange autumn trees, significantly larger." The autumn birch/maple mass
// lives on the plateau's north-east (the region divide crosses ~(-435,-1500) to
// (-537,-1700) up here, autumn to its east), which is ALSO the one plateau band the
// settled rail camera provably frames — a pure-red debug disc at the earlier
// circle-site (-450,-1790) never entered ANY 0.63-0.69 frame, while the drift mass
// shows in all of them. West shore in green meadow, east shore under the orange trees.
// Three earlier sites and two lying probe cameras are recorded in git history; the
// lesson that survives: site set-pieces from capture pixels and owner direction, never
// from a reimplemented camera.
// FINAL SITE, triangulated with colour-coded debug discs through the DENSE-station rail
// capture (sparse station lists leave sequence-dependent residual camera lag — see the
// capture-harness traps): the disc at (100, 400, −1300) is the one that shows, in the
// hollow at the massif's NE foot, at the west edge of the big autumn drift mass. The
// lake fills that hollow: massif and conifers over the west shore, the orange birch and
// maple mass at the east and north shores.
// The pocket is real terrain: the probed shelf floor runs 343-356 here (the massif skirt
// stands high over the west shore, the plateau rolls at the north and east), so the
// water sits at 354 — below every natural rim azimuth — and the bowls only deepen the
// middle rather than fighting a slope.
//
// TRIPLED AND SCULPTED (owner direction 2026-08-16): two overlapping lobes joined by the
// module's own smoothMax make a bean — the main body in the rail-visible pocket, a
// north-west arm bending around the conifer point toward the deep plateau (its far end
// slips over the visual horizon from the rail, which is exactly how a big lake reads).
// `odysseyNorthLakeRn` below is THE lake metric: the scatter's underwater kill, the
// lakeshore ring, the contrast-gate exclusion and the tests all call it, so the
// geometry has one owner and the calibrate-script mirror can no longer drift.
export const ODYSSEY_NORTH_LAKE = Object.freeze({
    waterY: 354,
    // Radii are the DISC extents. The shore meander below insets the carve within them,
    // so the water body averages ~0.64 of these — and the margin that leaves is what
    // buries the painted disc's own edge under terrain at every azimuth.
    lobes: Object.freeze([
        Object.freeze({
            x: 280, z: -1500, rx: 348, rz: 280, depth: 48,
        }),
        Object.freeze({
            x: -30, z: -1770, rx: 336, rz: 264, depth: 42,
        }),
        // The WAIST: the first two-lobe build read as two separate lakes — the neck's
        // floor stood 6 u above the water (per-lobe rn-0.4 probes never sample it).
        // This small lobe carves the neck itself, so the bean is one body of water.
        Object.freeze({
            x: 130, z: -1640, rx: 202, rz: 168, depth: 36,
        }),
    ]),
});

/**
 * THE SHORE MEANDER — why the waterline is not an ellipse.
 *
 * Measured on the first tripled build: the painted disc's edge was buried at every
 * azimuth, and the east shore STILL read as a hard geometric arc (the owner's report).
 * The reason is that the carve's own smoothstep reaches zero exactly at rn = 1, so on
 * flat ground — the east shelf is flat to ±2 u — the terrain crosses the water plane
 * within a hair of rn = 1 and the waterline traces the ellipse. Relief cannot break
 * that: it is ±1 u where the carve is ±40 u.
 *
 * So the CARVE BOUNDARY itself meanders, two octaves of the module's own value noise,
 * and the visible waterline is wherever that meandering bowl crosses the water plane —
 * bays, points, and a curvature that has nothing to do with an ellipse.
 *
 * ⚠️ ONE-SIDED BY CONSTRUCTION, and this is the invariant that keeps the paint honest.
 * The renderer draws plain ellipse discs at rn = 1 and knows nothing about this noise;
 * if the meander could push the carve OUTSIDE rn = 1 it would dig ground below the water
 * plane that no disc covers — a dry pit at lake level. The inset is therefore always
 * POSITIVE, so the carve stays strictly inside the disc, and the 0.06 floor keeps a
 * terrain margin (≈ 20 u on the main lobe) that buries the disc edge.
 */
const NORTH_LAKE_SHORE_MIN_INSET = 0.06;
const NORTH_LAKE_SHORE_MEANDER = 0.28;
/** Where the bowl's wall begins, and how hard it cuts the water plane (see the carve). */
const NORTH_LAKE_WALL_START = 0.74;
const NORTH_LAKE_WALL_POW = 0.6;
function northLakeShoreInset(x, z) {
    const broad = valueNoise((x / 205) + 37.4, (z / 205) - 11.8);
    const fine = valueNoise((x / 84) - 8.6, (z / 84) + 51.2);
    return NORTH_LAKE_SHORE_MIN_INSET
        + (((broad * 0.7) + (fine * 0.3)) * NORTH_LAKE_SHORE_MEANDER);
}

/**
 * Normalized lake distance, shore meander included: < 1 is inside the carve, and the
 * boundary is the meandering waterline rather than an ellipse. Every consumer — the
 * carve, the scatter's underwater kill, the lakeshore ring, the contrast-gate exclusion
 * and the tests — reads THIS function, so the organic outline is shared by construction
 * instead of by four copies agreeing.
 */
export function odysseyNorthLakeRn(x, z) {
    let best = Infinity;
    const { lobes } = ODYSSEY_NORTH_LAKE;
    for (let i = 0; i < lobes.length; i += 1) {
        const lb = lobes[i];
        const lx = (x - lb.x) / lb.rx;
        const lz = (z - lb.z) / lb.rz;
        best = Math.min(best, Math.sqrt((lx * lx) + (lz * lz)));
    }
    return best + northLakeShoreInset(x, z);
}

/**
 * THE NORTH HILLS (north-island plan Wave 2). Three soft swells that break the plateau's
 * pancake horizon behind the lake — the owner's "add hills". Same COMPACT profile as the
 * lake bowl (exactly zero at rn >= 1), for the same reason: the plateau pin and the lake's
 * own rim/water contract must be untouched by arithmetic. Sited so no swell reaches the
 * lake's waterline ring (H2's edge stops 20 u short of the north rim — a shore that RISES
 * beyond the water without lifting it), and all complete well south of the coast taper's
 * release at z = -2600.
 */
const NORTH_HILLS = Object.freeze([
    Object.freeze({
        x: -860, z: -1560, r: 300, h: 48,
    }), // NW backdrop swell
    // Rim swells behind the lake's north and east shores: silhouette behind the water
    // plus the rim lift the low east shelf needs, edges probed to contribute nothing
    // inside the waterline.
    Object.freeze({
        x: 380, z: -1220, r: 160, h: 24,
    }),
    Object.freeze({
        x: -1020, z: -1350, r: 280, h: 36,
    }), // links west toward the ridge
    Object.freeze({
        x: 600, z: -1450, r: 190, h: 30,
    }),
    // Behind the lake's north-west arm: the far shore rises into a hill instead of
    // running flat to the coast taper.
    Object.freeze({
        x: -160, z: -2160, r: 220, h: 40,
    }),
    // The south-east shore's own lift: the tripled main lobe reaches ground the east
    // swell cannot, and this closes the last low arc.
    Object.freeze({
        x: 560, z: -1720, r: 150, h: 22,
    }),
    // The NE and E banks. The sculpt pass enlarged the discs onto ground that ran BELOW
    // the water plane at a few azimuths — the one place the paint could have shown its
    // own geometry (measured -0.8 u before these went in, +6.1 u after). Centred well
    // outside the shoreline so they feather into the bank instead of pushing the
    // waterline inward.
    Object.freeze({
        x: 640, z: -1230, r: 200, h: 28,
    }),
    Object.freeze({
        x: 730, z: -1610, r: 210, h: 26,
    }),
]);

function smoothstep01(edge0, edge1, x) {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - (2 * t));
}

export const ODYSSEY_RELIEF_SCALE = 150;

// ── noise ────────────────────────────────────────────────────────────────────────

// Integer bit-mix, not sin(dot(..)) * 43758. The bake is a million samples and each one runs
// eight noise calls over four hashes; a transcendental hash puts ~32 million sin() on the
// startup critical path, which measured 3x slower end to end.
function hash2(x, y) {
    let h = ((x | 0) * 374761393) + ((y | 0) * 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - (2 * fx));
    const uy = fy * fy * (3 - (2 * fy));
    const a = hash2(ix, iy);
    const b = hash2(ix + 1, iy);
    const c = hash2(ix, iy + 1);
    const d = hash2(ix + 1, iy + 1);
    return (((a * (1 - ux)) + (b * ux)) * (1 - uy)) + ((((c * (1 - ux)) + (d * ux)) * uy));
}

/**
 * Polynomial smooth-max. Peaks must JOIN, not stack: summing two overlapping cones builds a
 * dome between them, and taking a hard max leaves a crease along the join. Both read as
 * obviously synthetic. `k` is the blend width in world units.
 */
export function smoothMax(a, b, k) {
    // The blend width scales with MAGNITUDE. A plain polynomial smooth-max adds k/4 even when
    // both inputs are equal, so smoothMax(0, 0, 26) returns 6.5 — and folding that over four
    // massifs silently lifted the entire world 26u, above sea level, leaving no ocean at all.
    // Scaling k to zero as the inputs go to zero makes it degrade to an exact max.
    const kEff = Math.min(k, Math.max(0, Math.max(a, b)));
    if (kEff <= 1e-6) return Math.max(a, b);
    const h = Math.max(0, Math.min(1, 0.5 + ((0.5 * (a - b)) / kEff)));
    return (b + ((a - b) * h)) + (kEff * h * (1 - h));
}

/** A single massif's contribution, in world units above the foot datum. */
export function massifTerm(massif, x, z) {
    const d = Math.hypot(x - massif.x, z - massif.z);
    const cone = Math.max(0, 1 - (d / massif.radius));
    return (cone ** massif.exponent) * massif.height;
}

// ── the field ────────────────────────────────────────────────────────────────────

/**
 * MACRO form — analytic and smooth. Ocean floor, the landmass that carries the shore, the Ch3
 * basin, and the four canonical peaks joined with a smooth max.
 */
export function odysseyWorldMacro(x, z) {
    // Continental shelf climbing from the abyss to the shore plateau, then a gentler inland
    // rise toward the peaks. Both taper laterally so the world returns to open ocean in x.
    const shelfT = smoothstep01(SHELF_FROM_Z, SHELF_TO_Z, z);
    const inlandT = smoothstep01(INLAND_FROM_Z, INLAND_TO_Z, z);
    const lateralN = (x - LAND_X) / LAND_HALF_WIDTH;
    const lateral = Math.max(0, 1 - (lateralN * lateralN));
    // The north coast: 1 across the whole inhabited landmass, easing to 0 across
    // NORTH_SHORE_FROM_Z..TO_Z so the island returns to open ocean in -z exactly as
    // `lateral` already returns it to ocean in x. See the constant block above.
    const northT = smoothstep01(NORTH_SHORE_TO_Z, NORTH_SHORE_FROM_Z, z);
    const land = ABYSS_Y + (((SHELF_RISE * shelfT) + (INLAND_RISE * inlandT)) * lateral * northT);

    // The Ch3 basin, scooped out so the chapter-3 lake has somewhere to sit.
    const bx = (x - BASIN_X) / BASIN_RX;
    const bz = (z - BASIN_Z) / BASIN_RZ;
    const basin = Math.exp(-((bx * bx) + (bz * bz))) * -BASIN_DEPTH;

    // The north lake's bowls: flat-ish floors, feathered rims, EXACT zero outside rn=1
    // per lobe (the compact profile is what keeps the plateau pin honest). The lobes join
    // through smoothMax so the shoreline waist is a smooth curve, not a crease — and the
    // shore MEANDER is added to every lobe's radius, so the carve boundary (and therefore
    // the waterline the depth buffer draws) wanders inside the disc instead of tracing an
    // ellipse. One noise evaluation per sample, shared by the lobes.
    //
    // ⚠️ THE REJECT TEST COMES FIRST, AND IT IS WHY THE BAKE IS STILL FAST. This function
    // runs once per texel of the macro plate (589k-1M samples at boot) and the shore noise
    // is two value-noise octaves — by far the most expensive term here. Only 2.0% of the
    // ±4500 plate is within any lobe, so the noise is evaluated only where it can matter.
    // The rejection is EXACT rather than a heuristic: the inset is strictly positive
    // (floor 0.06), so raw rn >= 1 gives rn_eff > 1, and the wall ramp is exactly 0 there.
    // Squared radii, so the far case costs no sqrt either.
    let lakeBowl = 0;
    let nearestLobeRn2 = Infinity;
    for (let i = 0; i < ODYSSEY_NORTH_LAKE.lobes.length; i += 1) {
        const lb = ODYSSEY_NORTH_LAKE.lobes[i];
        const lx = (x - lb.x) / lb.rx;
        const lz = (z - lb.z) / lb.rz;
        const rn2 = (lx * lx) + (lz * lz);
        if (rn2 < nearestLobeRn2) nearestLobeRn2 = rn2;
    }
    if (nearestLobeRn2 < 1) {
        const lakeInset = northLakeShoreInset(x, z);
        let lakeCarve = 0;
        for (let i = 0; i < ODYSSEY_NORTH_LAKE.lobes.length; i += 1) {
            const lb = ODYSSEY_NORTH_LAKE.lobes[i];
            const lx = (x - lb.x) / lb.rx;
            const lz = (z - lb.z) / lb.rz;
            const rn = Math.sqrt((lx * lx) + (lz * lz)) + lakeInset;
            // ⚠️ A POWER RAMP, NOT A SMOOTHSTEP, AND THAT IS THE WHOLE SHORELINE.
            //
            // smoothstep has ZERO derivative at both ends, so a smoothstep bowl approaches its
            // rim tangentially: measured on the previous build, 9 u inside the boundary the
            // carve was only 1.3 u deep — a 0.15 slope. The lake floor therefore met the flat
            // water plane at a grazing angle, and the intersection of two near-parallel
            // surfaces snaps to whatever the terrain MESH does — straight triangle-edge
            // segments and hard corners. That is the "sharp edge to the right" the owner saw,
            // and no amount of shore meander fixes it, because the meander moves the boundary
            // while the grazing crossing follows the mesh either way.
            //
            // `t^0.6` instead: 9 u inside the rim the carve is 10.7 u deep (slope 1.2), so the
            // floor CUTS the water plane and the waterline lands where the field says it does
            // — the meander, not the triangulation. The inner crease where the ramp meets the
            // flat floor sits well under water. Compactness is unchanged: t is 0 at rn >= 1.
            const wall = Math.max(0, Math.min(1, (1 - rn) / (1 - NORTH_LAKE_WALL_START)));
            lakeCarve = smoothMax(lakeCarve, (wall ** NORTH_LAKE_WALL_POW) * lb.depth, 8);
        }
        lakeBowl = -lakeCarve;
    }

    // The north hills: the same compact grammar, positive — and the same exact reject,
    // since smoothstep01(0.25, 1, hn) is 1 (contribution 0) for every hn >= 1.
    let hills = 0;
    for (let i = 0; i < NORTH_HILLS.length; i += 1) {
        const hh = NORTH_HILLS[i];
        const dx = x - hh.x;
        const dz = z - hh.z;
        const d2 = (dx * dx) + (dz * dz);
        if (d2 >= hh.r * hh.r) continue;
        const hn = Math.sqrt(d2) / hh.r;
        hills += (1 - smoothstep01(0.25, 1.0, hn)) * hh.h;
    }

    const ground = land + basin + lakeBowl + hills;

    // THE PEAKS RISE FROM THE GROUND, they do not replace it.
    //
    // The first version smooth-maxed the ground against an absolute `footY + cone`, which is
    // wrong twice over: outside a footprint the cone is zero, so the expression collapses to a
    // constant 297.5 and floors the whole planet above sea level; and it ignores that the
    // shipped peaks do not share one datum.
    //
    // Each peak instead contributes a RISE above the local ground, carried on a pedestal that
    // blends from the surrounding land to that peak's own shipped foot datum across the outer
    // third of its footprint. Outside the footprint the contribution is exactly zero, so the
    // ocean stays an ocean; at the centre the crown lands exactly on the shipped value.
    let rise = 0;
    for (let i = 0; i < ODYSSEY_MASSIFS.length; i += 1) {
        const m = ODYSSEY_MASSIFS[i];
        // Squared reject before the sqrt: the cone is exactly 0 at d >= radius, and this
        // loop runs once per massif per macro texel at boot.
        const mdx = x - m.x;
        const mdz = z - m.z;
        const md2 = (mdx * mdx) + (mdz * mdz);
        if (md2 >= m.radius * m.radius) continue;
        const d = Math.sqrt(md2);
        const cone = 1 - (d / m.radius);
        const t = Math.max(0, Math.min(1, cone / 0.35));
        const pedestalBlend = t * t * (3 - (2 * t));
        const pedestal = pedestalBlend * (m.footY - ground);
        const peak = pedestal + ((cone ** m.exponent) * m.height);
        rise = smoothMax(rise, peak, 26);
    }

    return ground + rise;
}

/** How much baked relief a point carries — ridges concentrate on the peaks. */
export function odysseyWorldDetailWeight(x, z) {
    let strongest = 0;
    for (let i = 0; i < ODYSSEY_MASSIFS.length; i += 1) {
        const m = ODYSSEY_MASSIFS[i];
        // Same exact reject: the halo term is 0 beyond 1.25x the footprint.
        const wdx = x - m.x;
        const wdz = z - m.z;
        const wd2 = (wdx * wdx) + (wdz * wdz);
        const halo = m.radius * 1.25;
        if (wd2 >= halo * halo) continue;
        strongest = Math.max(strongest, 1 - (Math.sqrt(wd2) / halo));
    }
    // The base weight is deliberately low. Relief is what gives the massif its character, but
    // away from the peaks it is also the only thing that can push terrain up through the rail,
    // and the rail's clearance margin is the one budget a height field must never overspend.
    return 0.16 + (0.84 * strongest);
}

/** LOCAL RELIEF, baked to half-float. Frequency band is set by the bake resolution, not taste. */
export function odysseyWorldRelief(x, z) {
    // Domain warp so ridgelines meander instead of running radially off each cone.
    const wf = 0.0009;
    const wx = (valueNoise((x * wf) + 31.7, (z * wf) - 11.3) - 0.5) * 300;
    const wz = (valueNoise((x * wf) - 7.1, (z * wf) + 53.9) - 0.5) * 300;
    const px = x + wx;
    const pz = z + wz;

    let ridged = 0;
    let amp = 1;
    let freq = 0.0022;
    let norm = 0;
    for (let o = 0; o < 5; o += 1) {
        const n = valueNoise((px * freq) + (o * 17.3), (pz * freq) - (o * 9.1));
        ridged += amp * (1 - Math.abs((n * 2) - 1));
        norm += amp;
        amp *= 0.5;
        freq *= 2.03;
    }
    ridged = (ridged / norm) ** 1.85;
    const relief = (ridged - 0.30) * ODYSSEY_RELIEF_SCALE;
    return Math.max(-ODYSSEY_RELIEF_SCALE, Math.min(ODYSSEY_RELIEF_SCALE, relief));
}

/**
 * THE drawn surface. Everything that needs to know where the ground is calls this — the vertex
 * shader (via macro + a sampled relief texture), prop seating, and camera grounding. One
 * function, so a tree can never float and a shadow can never disagree with a silhouette.
 */
export function odysseyWorldHeight(x, z) {
    return odysseyWorldMacro(x, z)
        + (odysseyWorldRelief(x, z) * odysseyWorldDetailWeight(x, z));
}

/** Depth of water at a point; negative means dry land. */
export function odysseyWaterDepth(x, z) {
    return ODYSSEY_SEA_LEVEL - odysseyWorldHeight(x, z);
}
