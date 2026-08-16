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

    const ground = land + basin;

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
        const d = Math.hypot(x - m.x, z - m.z);
        const cone = Math.max(0, 1 - (d / m.radius));
        if (cone <= 0) continue;
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
        const d = Math.hypot(x - m.x, z - m.z);
        strongest = Math.max(strongest, Math.max(0, 1 - (d / (m.radius * 1.25))));
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
