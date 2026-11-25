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

import { odysseyMassifDelta } from './odyssey-massif-form-decode.js';

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
 *
 * ⚠️ RE-MEASURED 2026-10-02 (seamless pass): 0.20023 above predates two re-layouts. On the live
 * spline the RAIL crosses sea level at 0.13381 and the EYE (real computeFollowFrame, settled,
 * with the seam phase and act camera the board feeds it) at **0.13727** — the seam capture shows
 * the eye breaking the surface between its 0.1367 and 0.1427 stations. At 0.20023 the
 * surface-break stinger fired ~150 u after the breach, deep into chapter 3's meadow.
 * `odyssey-breach-p.test.js` recomputes the eye crossing from the live layout and fails if this
 * drifts again (a re-layout or a framing change must update it here).
 */
export const ODYSSEY_BREACH_P = 0.13727;

/** The datum the canonical peaks' feet sit on. */
export const ODYSSEY_MASSIF_FOOT_Y = 297.5556;

/** How deep the open ocean floor sits below sea level, far from the landmass. */
export const ODYSSEY_ABYSS_DEPTH = 207;

/**
 * The canonical peaks (odyssey-peak-specs.js). `radius` is `size * PEAK_CONE_RADIUS_FRAC` (0.45),
 * the footprint the peak actually reaches.
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
        id: 'far-left',
        x: -1892.7,
        z: -1639.3,
        radius: 675,
        height: 430,
        exponent: 1.55,
        footY: 247.5556,
        // Drawn as an older mountain since 2026-11-25 (ridgedMassifRise): a ridge running north-east,
        // a rounder top, a shoulder down the ridge toward the meadows' view.
        ridge: Object.freeze({
            bearing: 0.62, squeeze: 0.62, exponent: 1.25, shoulder: Object.freeze([0.34, 0.62]),
        }),
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

/**
 * THE SOUTH COAST'S LINE (2026-11-25). The shore every orb from the sea looks at was the contour of
 * one smoothstep in z: a ruler-straight beach of one width from one side of the frame to the other,
 * "a kerb" (the coast's audit). It bends now, along x:
 *   - `bends`: coves (+, the shore laid back inland) and points (-, the land out into the sea), each a
 *     compact (1 - u^2)^2 bump of `shift` u over `w` u either side of its `x`. The shelf's z is moved by
 *     their sum, fully from the shore inland and fading out to sea across `seaward` (z), so the deep
 *     flank (the reef's) keeps its form. The rail's landing and the reef's flank (x -280..90) are left as
 *     they were: the glade's deer, the horses and the authored pines stand on that bank, and the reef
 *     is planted on that slope.
 *   - the beach: within `band` u of the sea's level the ground is laid back in a cove (its slope x
 *     `cove` at the waterline, a wide flat beach and wide shallows) and stood up on a point (x `point`:
 *     a narrow strand, the grass and the rock nearer the water), and a cove's beach carries little
 *     of the relief (`reliefKeep`).
 * Compact: nothing moves outside the bends' reach in x or seaward of `seaward[0]`.
 */
export const ODYSSEY_SOUTH_COAST = Object.freeze({
    bends: Object.freeze([
        Object.freeze({ x: -760, w: 200, shift: 32 }),
        Object.freeze({ x: -440, w: 160, shift: -40 }),
        Object.freeze({ x: 290, w: 200, shift: 48 }),
        Object.freeze({ x: 560, w: 140, shift: -32 }),
    ]),
    seaward: Object.freeze([-70, -200]),
    band: 28,
    cove: 0.25,
    point: 1.5,
    /** The shift (u) at which a bend's beach is wholly a cove's or a point's. */
    full: 36,
    reliefKeep: 0.3,
});
const SC = ODYSSEY_SOUTH_COAST;

/** How far the south shore is laid back (+) or brought out (-) at `x`, u. */
export function odysseySouthCoastShift(x) {
    let shift = 0;
    for (let i = 0; i < SC.bends.length; i += 1) {
        const b = SC.bends[i];
        const u = (x - b.x) / b.w;
        if (u > -1 && u < 1) shift += b.shift * ((1 - (u * u)) ** 2);
    }
    return shift;
}

/** The shore's lay at `x`: the beach band's slope factor at the waterline (< 1 a cove, > 1 a point). */
function southCoastLay(shift) {
    const t = Math.min(1, Math.abs(shift) / SC.full);
    return shift >= 0 ? 1 - ((1 - SC.cove) * t) : 1 + ((SC.point - 1) * t);
}

/** The beach band laid back or stood up: monotonic, and the ground itself beyond `band`. */
function southCoastBeach(shift, ground) {
    if (shift === 0) return ground;
    const d = ground - ODYSSEY_SEA_LEVEL;
    const a = Math.abs(d);
    if (a >= SC.band) return ground;
    const k = southCoastLay(shift);
    const t = a / SC.band;
    return ODYSSEY_SEA_LEVEL + (d * (k + ((1 - k) * t * t * (3 - (2 * t)))));
}

/** The Ch3 basin — an inland lake bowl, sited past the shoreline rather than in the surf. */
const BASIN_X = -150;
const BASIN_Z = -520;
const BASIN_RX = 430;
const BASIN_RZ = 330;
const BASIN_DEPTH = 42;

/**
 * THE NORTH LAKE (north-island plan Wave 1, owner-directed 2026-08-16; redrawn 2026-11-21). The
 * 1C flyby made the plateau behind the hero massif primary real estate (the climb looks down
 * across it at p 0.55-0.68), and the owner marked this shelf for a lake: "the lake on the edge of
 * the orange autumn trees, significantly larger." The SITE is the owner's: the hollow at the
 * massif's north-east foot, the west shore in green meadow under the massif's skirt, the east and
 * north shores under the autumn birch and maple, the main body in the pocket the climb's rail
 * camera sees, the water at 354 (below every rim), some 230k u^2 of it (the owner approved
 * 228-250k).
 *
 * A DRAWN SHORE (2026-11-21, after the tarn's redraw; Olov: "The ponds needs to have a better
 * shape also"). It was three ellipse lobes joined (a main body, a north-west arm and a waist)
 * with a noise inset on the rim, carved into the macro field: from the climb it read as a rounded
 * bean, a swimming-pool cyan blot in a pale ring of rock (the carve's wall, the same steep drop all
 * round). It is a drawn water now, the tarn's kind (see THE DRAWN WATERS below): an outline drawn
 * by hand, clockwise from the west end, and a profile across it.
 *   - the main open water in the rail-visible pocket, a wide shallow beach bay at its near (south)
 *     end beside a blunt point, a cove on the west shore under the massif's skirt;
 *   - a peninsula of autumn birch and maple running west from the east shore, an islet off its
 *     tip, lying across the climb's view, and a north bay behind it;
 *   - the north-west arm (the owner's) tapering round the conifer point, an islet midway, a far
 *     basin at its end;
 *   - the east shore under the gold and red trees, with a promontory and a bay.
 * Its bank is long and gentle (`bank` 110 u): from 600-1000 u off, the ground eases into the
 * water instead of dropping (the old wall painted as rock, a pale ring 50 px wide).
 */
export const ODYSSEY_NORTH_LAKE = Object.freeze({
    waterY: 354,
    floorY: 320,
    /** The shore, clockwise from the west end (world x, z). */
    outline: Object.freeze([
        [-238, -1858], [-232, -1893], [-200, -1915], [-150, -1925], [-105, -1905], [-60, -1888],
        [-20, -1890], [18, -1910], [55, -1900], [95, -1876], [135, -1845], [180, -1852],
        [212, -1880], [250, -1903], [300, -1912], [352, -1905], [395, -1885], [420, -1850],
        [428, -1808], [426, -1778], [412, -1766], [365, -1764], [318, -1752], [278, -1730],
        [284, -1702], [330, -1688], [385, -1690], [440, -1700], [490, -1712], [528, -1698],
        [560, -1672], [566, -1630], [540, -1600], [505, -1588], [522, -1560], [555, -1535],
        [568, -1495], [556, -1452], [538, -1415], [540, -1380], [520, -1342], [485, -1318],
        [440, -1322], [395, -1360], [350, -1335], [310, -1345], [275, -1370], [240, -1400],
        [222, -1440], [195, -1455], [165, -1475], [155, -1510], [178, -1545], [180, -1582],
        [172, -1612], [160, -1640], [135, -1650], [100, -1655], [60, -1670], [20, -1695],
        [-25, -1712], [-48, -1738], [-75, -1752], [-125, -1772], [-180, -1808],
    ].map((p) => Object.freeze(p))),
    /** Islets: one off the peninsula's tip, one midway along the north-west arm. */
    islets: Object.freeze([
        Object.freeze([[205, -1742], [215, -1757], [240, -1761], [254, -1749], [248, -1733], [224, -1729]]
            .map((p) => Object.freeze(p))),
        Object.freeze([[-64, -1803], [-54, -1816], [-30, -1819], [-16, -1806], [-26, -1792], [-50, -1791]]
            .map((p) => Object.freeze(p))),
    ]),
    isletRise: 4,
    isletReach: 14,
    ragged: Object.freeze([6, 2.5]),
    raggedCells: Object.freeze([70, 26]),
    // (A broad shelf, stepping down quickly: from the climb, 600-1000 u off, the turquoise is the
    // water over the shelf, 1-4 u deep, and a narrow shelf left it a pixel wide; on a gentler one the
    // first unit of water, where the sand shows through, read as a pale ring 15-30 u wide.)
    shelf: Object.freeze([6, 30]),
    // (Broad turquoise flats in some bays, a quick drop off others: a band of one width round the
    // whole shore read as an outline.)
    shelfVary: 1.3,
    shelfSlope: Object.freeze([0.22, 0.12]),
    shelfBank: Object.freeze([3, 14]),
    drop: 60,
    floor: 28,
    roll: 5,
    bank: 110,
    beachRise: 2.5,
    /** One unit of `odysseyNorthLakeRn` beyond the shore, in world units (the lakeshore ring's band). */
    rnUnit: 300,
    /** The drawn curve's pieces a span (shore, islets), and the profile's noise scales (u). */
    curve: Object.freeze({ per: 8, isletPer: 6 }),
    noise: Object.freeze({ shelfCell: 90, rollCells: Object.freeze([140, 50]), fineRoll: 1.5 }),
});

/**
 * THE NORTH HILLS (north-island plan Wave 2). Three soft swells that break the plateau's
 * pancake horizon behind the lake — the owner's "add hills". A COMPACT profile (exactly zero
 * at rn >= 1), so the plateau pin is untouched by arithmetic. They were sited so no swell
 * reached the old lake bowl's waterline ring; the drawn lake (2026-11-21) is applied over the
 * ground with its own profile, so its waterline and bank are its own whatever a swell adds
 * under them. All complete well south of the coast taper's release at z = -2600.
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

/**
 * THE PLAIN'S SWELLS AND HOLLOWS (2026-11-02, the land behind the mountain). From the top of the
 * chapter-5 climb (p 0.60-0.68) the camera looks down at 15-25 degrees over the plateau north-east
 * of the lake, and it read as a flat green map. These are soft, broad rises and dips there: low
 * (10-18 u) and wide (140-210 u in radius), so under the low side sun each one has a lit flank
 * and a shaded one. The same compact profile as the north hills (exactly zero at hn >= 1),
 * signed, and sited clear of the lake (no rim moves) and of the plateau pins at (-700, -1900) and
 * (-220, -2400). Where the north beach's bank reaches one, the bank is drawn over it.
 */
const PLAIN_SWELLS = Object.freeze([
    Object.freeze({
        x: 860, z: -1880, r: 210, h: 18,
    }), // between the lake's east shore and the east coast
    Object.freeze({
        x: 980, z: -1450, r: 170, h: 12,
    }),
    Object.freeze({
        x: 470, z: -2120, r: 170, h: -10,
    }), // a hollow north-east of the lake, behind the bay
    Object.freeze({
        x: 230, z: -2240, r: 140, h: 14,
    }),
    Object.freeze({
        x: 40, z: -2580, r: 190, h: -10,
    }),
]);

/**
 * THE NORTH BEACH (2026-11-02). The north coast was a steep bank: from the climb the shoreline
 * hid behind its own brow and read as a thin pale line. This is a wide crescent bay cut into the
 * island's north-east corner, the coast the climb-top views (p 0.60-0.68, heading ~40-50 deg)
 * look straight at, ~1,700-2,100 u out. Its chord runs from the north coast to the east coast,
 * across the view, so the crescent spans the frame with its belly toward the camera.
 *
 * In the bay's own frame (`u` along the chord from its middle, `v` inland across it) the
 * waterline is a parabola, `bite` inland at the middle and on the chord at the horns. `s` is the
 * distance inland from it. Across `s` the ground is drawn to one profile:
 *
 *   - a shelving seabed, `shelfDepth` deep `shelf` u out, then falling to the sea floor (so the
 *     shallows exist for the water's depth colour to show);
 *   - a gently rising beach of pale sand, `beach` u wide, `beachTop` u high at the dune foot;
 *   - dunes, low ridges along the shore broken into hummocks, below the plateau everywhere;
 *   - a grassy bank rising back to the land.
 *
 * Compact like every term here: the profile is blended in by `beachWeight`, which is exactly zero
 * beyond the horns (`hornOut`), past `shelfOut` seaward and past `bankTo` inland. It finishes
 * well inside the coast's own taper (z > -3400) and the bake plate, and far from the rail.
 */
export const ODYSSEY_NORTH_BEACH = Object.freeze({
    /** The horns: on the north coast, and on the east coast. */
    ax: 420,
    az: -2890,
    bx: 1175,
    bz: -2240,
    bite: 150,
    beach: 120,
    beachTop: 4.5,
    duneBack: 270,
    duneTop: 11,
    duneHump: 8,
    bankTo: 680,
    bankSlope: 0.26,
    shelf: 380,
    shelfDepth: 26,
    shelfOut: 540,
    /** Lateral taper, as fractions of the half-chord. */
    hornIn: 0.75,
    hornOut: 1.45,
    /** How much of the relief survives on the beach (it would break a 2-degree slope). */
    reliefKeep: 0.04,
});

const BEACH = ODYSSEY_NORTH_BEACH;
const BEACH_LEN = Math.hypot(BEACH.bx - BEACH.ax, BEACH.bz - BEACH.az);
/** The bay's frame: middle of the chord, the unit chord, the inland normal, the half-chord. */
export const ODYSSEY_NORTH_BEACH_FRAME = Object.freeze({
    mx: (BEACH.ax + BEACH.bx) / 2,
    mz: (BEACH.az + BEACH.bz) / 2,
    tx: (BEACH.bx - BEACH.ax) / BEACH_LEN,
    tz: (BEACH.bz - BEACH.az) / BEACH_LEN,
    nx: -(BEACH.bz - BEACH.az) / BEACH_LEN,
    nz: (BEACH.bx - BEACH.ax) / BEACH_LEN,
    halfChord: BEACH_LEN / 2,
});
const BF = ODYSSEY_NORTH_BEACH_FRAME;

/**
 * Where a point sits in the bay: `u` along the chord, `s` inland of the waterline (negative out at
 * sea), and `wU` the lateral weight (1 between the horns, 0 beyond them). Null outside the box the
 * bay can touch, which is the exact reject that keeps the bakes fast.
 * @param {number} x
 * @param {number} z
 * @returns {{u:number, s:number, wU:number}|null}
 */
export function odysseyNorthBeachAt(x, z) {
    const dx = x - BF.mx;
    const dz = z - BF.mz;
    const u = (dx * BF.tx) + (dz * BF.tz);
    const U = BF.halfChord;
    if (Math.abs(u) >= U * BEACH.hornOut) return null;
    const v = (dx * BF.nx) + (dz * BF.nz);
    const un = u / U;
    const s = v - (BEACH.bite * (1 - (un * un)));
    if (s <= -BEACH.shelfOut || s >= BEACH.bankTo) return null;
    const wU = 1 - smoothstep01(BEACH.hornIn, BEACH.hornOut, Math.abs(un));
    return { u, s, wU };
}

/**
 * How much of the bay's profile holds at a point, in [0, 1]: the lateral weight times the
 * cross-shore one (whole from the shelf to the dunes' back, feathered out to sea and up the
 * bank). Exactly 0 outside the bay. The relief and the ground shader read the same weight.
 * @param {number} x
 * @param {number} z
 * @returns {number}
 */
export function odysseyNorthBeachWeight(x, z) {
    const b = odysseyNorthBeachAt(x, z);
    if (!b) return 0;
    return b.wU * beachCrossWeight(b.s, z);
}

/** The coast's own closing law: nothing of the bay reaches the open sea past here (z). */
const BEACH_SEA_CLOSE = Object.freeze([-3400, -3250]);

function beachCrossWeight(s, z) {
    if (s < 0 && z < BEACH_SEA_CLOSE[1]) {
        if (z <= BEACH_SEA_CLOSE[0]) return 0;
        return beachCrossWeight(s, BEACH_SEA_CLOSE[1]) * smoothstep01(BEACH_SEA_CLOSE[0], BEACH_SEA_CLOSE[1], z);
    }
    if (s < -BEACH.shelf) return smoothstep01(-BEACH.shelfOut, -BEACH.shelf, s);
    if (s > BEACH.duneBack) return 1 - smoothstep01(BEACH.duneBack, BEACH.bankTo, s);
    return 1;
}

/**
 * The dunes' own relief: low ridges along the shore (stretched along the chord), broken into
 * hummocks, inside a window across the dune belt. World units above the dune base.
 */
function beachDunes(u, s) {
    const win = smoothstep01(BEACH.beach - 20, BEACH.beach + 50, s)
        * (1 - smoothstep01(BEACH.duneBack - 90, BEACH.duneBack + 30, s));
    if (win <= 0) return 0;
    const ridge = valueNoise((u / 115) + 7.3, (s / 58) - 2.1);
    const hummock = valueNoise((u / 64) - 3.7, (s / 64) + 11.9);
    return BEACH.duneHump * win * (((ridge * 0.65) + (hummock * 0.35)) ** 1.5);
}

/**
 * The bay's profile at `s` (height above sea level) — seabed, beach, dune base, bank.
 * @param {number} s
 * @returns {number}
 */
export function odysseyNorthBeachProfile(s) {
    if (s <= 0) {
        // The shelf: shallow for a long way, then deepening (Dean's beach profile, near enough).
        return -BEACH.shelfDepth * (Math.min(1, -s / BEACH.shelf) ** 1.25);
    }
    if (s <= BEACH.beach) return BEACH.beachTop * ((s / BEACH.beach) ** 0.8);
    if (s <= BEACH.duneBack) {
        const t = (s - BEACH.beach) / (BEACH.duneBack - BEACH.beach);
        return BEACH.beachTop + ((BEACH.duneTop - BEACH.beachTop) * t);
    }
    return BEACH.duneTop + ((s - BEACH.duneBack) * BEACH.bankSlope);
}

/** The bay drawn over the `ground` the rest of the macro field gives. */
function northBeachBlend(x, z, ground) {
    const b = odysseyNorthBeachAt(x, z);
    if (!b) return ground;
    const w = b.wU * beachCrossWeight(b.s, z);
    if (w <= 0) return ground;
    let target = ODYSSEY_SEA_LEVEL + odysseyNorthBeachProfile(b.s) + beachDunes(b.u, b.s);
    // The bank only ever cuts down to the beach: where the land behind is low it is left alone.
    if (b.s > BEACH.duneBack) target = Math.min(target, ground);
    return ground + ((target - ground) * w);
}

/**
 * THE OUTER ISLES (all-angles pass, 2026-10-18). From the coast (chapters 3-4) and from the
 * climb (chapter 5) half of every turn of the head faced open sea: water to a white horizon with
 * nothing standing on it. These are the archipelago the island belongs to — a volcano, a long
 * isle, a few small ones — far enough out that the haze turns them blue-grey, near enough to
 * hold a silhouette (2-4 km, 4-8 degrees above the horizon from the shore).
 *
 * Each is COMPACT like the hills: exactly zero outside its footprint, so the open sea, the
 * offshore depth probe at (2600, 1800) and the bake-plate boundary are untouched. All of them
 * finish 500+ u inside the ±4500 plate (its edge clamp must keep extruding ocean), south of the
 * coast or beyond the main landmass's lateral taper, and 1.4+ km from every stretch of rail.
 *   rx/rz  footprint radii (the shelf starts there); angle rotates the footprint (radians)
 *   top    summit height ABOVE SEA LEVEL; shore  where the body breaks the surface, as a fraction
 *   of the footprint; exponent  the body's profile (higher = steeper, more peaked)
 */
export const ODYSSEY_OUTER_ISLES = Object.freeze([
    Object.freeze({
        id: 'volcano', x: 700, z: 2850, rx: 880, rz: 820, angle: 0.3, top: 440, shore: 0.52, exponent: 1.55,
    }),
    Object.freeze({
        id: 'long-isle', x: -2750, z: 3150, rx: 980, rz: 420, angle: -0.35, top: 190, shore: 0.6, exponent: 1.2,
    }),
    Object.freeze({
        id: 'near-isle', x: -1450, z: 1950, rx: 520, rz: 440, angle: 0.8, top: 150, shore: 0.55, exponent: 1.35,
    }),
    Object.freeze({
        id: 'islet-a', x: 1750, z: 2150, rx: 230, rz: 200, angle: 0, top: 70, shore: 0.5, exponent: 1.4,
    }),
    Object.freeze({
        id: 'islet-b', x: 1500, z: 2480, rx: 170, rz: 150, angle: 0.5, top: 45, shore: 0.45, exponent: 1.3,
    }),
    Object.freeze({
        id: 'east-isle', x: 3350, z: -350, rx: 640, rz: 560, angle: 1.1, top: 230, shore: 0.55, exponent: 1.45,
    }),
    Object.freeze({
        id: 'west-isle', x: -3780, z: 700, rx: 520, rz: 480, angle: 0.2, top: 175, shore: 0.55, exponent: 1.4,
    }),
]);

/** Footprint coordinate of a point for one isle: 0 at the centre, 1 at the shelf's foot. */
function isleRadius(isle, x, z) {
    const dx = x - isle.x;
    const dz = z - isle.z;
    const c = Math.cos(isle.angle);
    const s = Math.sin(isle.angle);
    const u = ((dx * c) + (dz * s)) / isle.rx;
    const v = ((dz * c) - (dx * s)) / isle.rz;
    return Math.sqrt((u * u) + (v * v));
}

/**
 * One isle's rise above the open-sea floor at a point: a shelf from the abyss to just under the
 * surface across the outer footprint, then the body breaking the surface at `shore` and peaking
 * at `top` above sea level. Exactly 0 at n >= 1.
 */
function isleRise(isle, n, floorY) {
    if (n >= 1) return 0;
    const shelfTop = ODYSSEY_SEA_LEVEL - 6;
    const shelf = smoothstep01(1, isle.shore + 0.08, n) * Math.max(0, shelfTop - floorY);
    const body = n < isle.shore ? ((1 - (n / isle.shore)) ** isle.exponent) * (isle.top + 6) : 0;
    return shelf + body;
}

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
 * A massif drawn as an OLDER mountain (2026-11-25, the mountain's audit M8: the far peak was the hero's
 * own needle cone in small): a ridge, longer along `ridge.bearing` than across it, with a rounder top
 * (`ridge.exponent`) and a lower shoulder down the ridge (`ridge.shoulder`: where along it, as a share of
 * the radius, and how high, as a share of the crown). Its crown stays the shipped one, exactly, at its
 * shipped place; nothing reaches past its footprint (the across-ridge squeeze only shrinks it).
 * @param {{radius: number, height: number, ridge: {bearing: number, squeeze: number, exponent: number, shoulder: number[]}}} m
 * @param {number} dx
 * @param {number} dz
 */
function ridgedMassifRise(m, dx, dz) {
    const R = m.ridge;
    const c = Math.cos(R.bearing);
    const sn = Math.sin(R.bearing);
    const along = (dx * c) + (dz * sn);
    const across = ((-dx * sn) + (dz * c)) / R.squeeze;
    const body = Math.max(0, 1 - (Math.hypot(along, across) / m.radius));
    const top = (body ** R.exponent) * m.height;
    const sa = along - (R.shoulder[0] * m.radius);
    const sBody = Math.max(0, 1 - (Math.hypot(sa, across) / (m.radius * 0.55)));
    const shoulder = (sBody ** R.exponent) * m.height * R.shoulder[1];
    return smoothMax(top, shoulder, 18);
}

/**
 * The landmass and the Ch3 basin at (x, z), before the hills, the isles and the peaks: the shelf from
 * the abyss to the shore plateau (its z moved by the south coast's bends, `coast`), the inland rise,
 * both tapered in x and closed by the north coast.
 */
function shelfGround(x, z, coast) {
    // Continental shelf climbing from the abyss to the shore plateau, then a gentler inland
    // rise toward the peaks. Both taper laterally so the world returns to open ocean in x.
    const zc = coast === 0 ? z : z + (coast * smoothstep01(SC.seaward[0], SC.seaward[1], z));
    const shelfT = smoothstep01(SHELF_FROM_Z, SHELF_TO_Z, zc);
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
    return { land, basin };
}

/**
 * How much of a south cove's beach is beach at (x, z), 0..1: the cove's own weight inside the band
 * round the sea's level. The relief stands back there (a laid-back beach is smooth sand).
 */
export function odysseySouthCoastBeachWeight(x, z) {
    const coast = odysseySouthCoastShift(x);
    if (coast <= 0 || z > SC.seaward[0]) return 0;
    const g = shelfGround(x, z, coast);
    const d = Math.abs(g.land + g.basin - ODYSSEY_SEA_LEVEL);
    return Math.min(1, coast / SC.full) * (1 - smoothstep01(SC.band * 0.6, SC.band * 1.4, d));
}

/**
 * MACRO form — analytic and smooth. Ocean floor, the landmass that carries the shore, the Ch3
 * basin, and the four canonical peaks joined with a smooth max.
 */
export function odysseyWorldMacro(x, z) {
    // The landmass and the Ch3 basin, the shelf's z moved by the south coast's bends.
    const coast = odysseySouthCoastShift(x);
    const shoreline = shelfGround(x, z, coast);

    // (The north lake's bowl lived here until 2026-11-21: it is a drawn water now, applied over
    // the whole field with the tarn's, odysseyNorthLakeProfile.)

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
    // The plain's swells and hollows: the same profile, signed.
    for (let i = 0; i < PLAIN_SWELLS.length; i += 1) {
        const ps = PLAIN_SWELLS[i];
        const dx = x - ps.x;
        const dz = z - ps.z;
        const d2 = (dx * dx) + (dz * dz);
        if (d2 >= ps.r * ps.r) continue;
        hills += (1 - smoothstep01(0.25, 1.0, Math.sqrt(d2) / ps.r)) * ps.h;
    }

    // The outer isles: compact, and only where the land term is still the open-sea floor.
    let isles = 0;
    for (let i = 0; i < ODYSSEY_OUTER_ISLES.length; i += 1) {
        const isle = ODYSSEY_OUTER_ISLES[i];
        const reach = Math.max(isle.rx, isle.rz);
        const ix = x - isle.x;
        const iz = z - isle.z;
        if ((ix * ix) + (iz * iz) >= reach * reach) continue;
        isles = Math.max(isles, isleRise(isle, isleRadius(isle, x, z), shoreline.land));
    }

    // The north beach is drawn over everything else there (it replaces the steep coast).
    const ground = northBeachBlend(x, z, southCoastBeach(coast, shoreline.land + shoreline.basin + hills + isles));

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
        const peak = pedestal + (m.ridge ? ridgedMassifRise(m, mdx, mdz) : ((cone ** m.exponent) * m.height));
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
    // The isles carry relief on their bodies (ridges and a ragged coast instead of a smooth
    // cone), capped lower than the massifs': they are seen from kilometres away.
    for (let i = 0; i < ODYSSEY_OUTER_ISLES.length; i += 1) {
        const isle = ODYSSEY_OUTER_ISLES[i];
        const reach = Math.max(isle.rx, isle.rz);
        const ix = x - isle.x;
        const iz = z - isle.z;
        if ((ix * ix) + (iz * iz) >= reach * reach) continue;
        const n = isleRadius(isle, x, z);
        strongest = Math.max(strongest, 0.45 * (1 - smoothstep01(isle.shore * 0.5, isle.shore + 0.15, n)));
    }
    // The base weight is deliberately low. Relief is what gives the massif its character, but
    // away from the peaks it is also the only thing that can push terrain up through the rail,
    // and the rail's clearance margin is the one budget a height field must never overspend.
    const weight = 0.16 + (0.84 * strongest);
    // ...and almost none on the north beach: +-10 u of relief would break a 2-degree beach.
    const beachW = odysseyNorthBeachWeight(x, z);
    // ...and less on a south cove's beach (its sand is laid back).
    const coveW = odysseySouthCoastBeachWeight(x, z);
    const kept = coveW > 0 ? 1 - ((1 - ODYSSEY_SOUTH_COAST.reliefKeep) * coveW) : 1;
    return (beachW > 0 ? weight * (1 - ((1 - ODYSSEY_NORTH_BEACH.reliefKeep) * beachW)) : weight) * kept;
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

// ── THE MASSIF'S FORM (2026-11-25, grown as a landform; it replaces the summit sculpt) ─────────

/**
 * THE HERO MASSIF'S FORM. The hero was a radial cone (`massifTerm`) under ridged noise, with a
 * procedural top on it (a horn, four aretes, couloirs and a rock step every 22 u). Judged from the
 * pixels (docs/ODYSSEY_MOUNTAIN_AUDIT_2026-11.md) it read as a cone with a layer cake wrapped round it.
 *
 * Now the mountain is grown in Blender (scripts/blender/odyssey/odyssey_massif.py): ridges drawn over
 * the island's cone (a summit block with a main top, a notch and an eastern top; a long west arete to
 * the left shoulder, a shorter, stepped east arete to the right one; two ribs down the climb's face;
 * three ridges at the back), faces hollowed between them and a cirque on the south-east face; rain
 * cutting gullies into couloirs and dropping fans at their feet, five hard beds standing as broken
 * cliff bands, frost laying the loose ground at its angle of rest. Inside a clearance kept round the
 * rail (46 u, opening at 65 degrees past 60 u) and faded out across the massif's foot, so the meadows,
 * the tarn, the forest's floor and the animals' ground keep their height.
 *
 * It is shipped as the height it ADDS over the island's ground (macro + relief x weight) on the sculpt
 * plate's square (`world/odyssey-massif-form.js`, decoded by `odyssey-massif-form-decode.js`), so this
 * stays one delta over the field, the old sculpt's place: in the CPU height, the sculpt plate the
 * ground reads, and everything that seats on either.
 */
export const ODYSSEY_SUMMIT_SCULPT = Object.freeze({
    /** The hero apex (ODYSSEY_MASSIFS' hero). */
    x: -182.7,
    z: -1059.3,
    /** The form's own square: it is zero beyond its border (ODYSSEY_MASSIF_GRID). */
    reach: 640,
});

/**
 * The massif's form at (x, z): the height it adds over the island's ground, world units (0 off its
 * square and across the massif's foot).
 * @param {number} x
 * @param {number} z
 * @returns {number}
 */
export function odysseySummitSculpt(x, z) {
    return odysseyMassifDelta(x, z);
}

function smoothstepRange(a, b, x) {
    const u = Math.min(Math.max((x - a) / (b - a), 0), 1);
    return u * u * (3 - (2 * u));
}

// ── THE TARN (2026-10-26, Act II masterpiece pass, step 6; redrawn 2026-11-20) ─────────────

/**
 * THE TARN — the pond the chapter-3 basin was scooped for. The macro field has carried an inland
 * lake bowl since Wave 2 ("the Ch3 basin", BASIN_*), and the One World never put water in it; the
 * north lake, the act's only other water above the sea, stands behind the hero massif from every
 * chapter 3-4 station and below the frame through the climb. So a small tarn is set in the basin's
 * meadow at the massif's foot, on the line the chapter-4 eyes look along: in frame and unblocked
 * from L18 to L23 (p 0.23-0.30), 100-270 u out and 60-110 u below the eye.
 *
 * A DRAWN SHORE (2026-11-20, Olov: "improve the looks of the pond ... the ponds need to have a
 * better shape"). It was three ellipses joined, and it read as three circles in a dug bowl: the
 * lobes showed in the outline, the depth's plates ran in rings round each of them, and the bowl's
 * wall (the same drop all the way round) stood as a dark ring in the meadow. Now the shore is an
 * OUTLINE drawn by hand (`outline`, a closed curve through its points, world x and z, clockwise
 * from the west end), the way a tarn lies in a meadow under a mountain:
 *   - a small west pool and a wider main water, joined by a strait;
 *   - one long point running out from the north shore, an islet off its tip;
 *   - bays of different sizes on the south shore, none opposite another;
 *   - the east end drawn out into a narrow inlet.
 * A low noise moves the drawn line a few units in and out (`ragged`), so no stretch of it is a
 * ruled curve.
 *
 * ACROSS THE SHORE the ground is a profile of the distance to that line, not a bowl:
 *   - under the water a SHELF (the shallows, a gentle slope), then a drop to a floor that rolls
 *     (`floor`, `roll`). The shelf is wide where the meadow lies flat by the water and narrow
 *     under a rising bank, as it is in a real pond: so the pale shallows are a broad flat in the
 *     east and the south-east and a thin line under the north shore;
 *   - above it a low beach on the same slope, easing over `bank` units into the meadow's own
 *     ground. Where the meadow stands high over the water (the west) that is a long gentle slope,
 *     not a wall.
 * The profile sets the ground ABSOLUTELY inside the shore (the waterline is the drawn line
 * itself, whatever the meadow's height there was), and it is exactly the meadow's own ground
 * beyond `bank` (the forest scatter, the rail's clearances and the orbs see no change there).
 */
export const ODYSSEY_TARN = Object.freeze({
    waterY: 293.0,
    /** The floor is never lower than this (the rolling floor's deepest, with room). */
    floorY: 288.2,
    /** The shore, clockwise from the west end (world x, z). */
    outline: Object.freeze([
        [-356, -446], [-350, -456], [-337, -463], [-321, -461], [-309, -453], [-300, -449],
        [-290, -451], [-282, -457], [-274, -465], [-262, -466], [-250, -467], [-243, -464],
        [-240, -457], [-236, -447], [-231, -441], [-227, -449], [-226, -460], [-220, -464],
        [-207, -467], [-190, -467], [-174, -464], [-160, -459], [-150, -456], [-140, -449],
        [-128, -443], [-136, -437], [-146, -428], [-152, -416], [-163, -406], [-178, -400],
        [-194, -398], [-207, -403], [-214, -411], [-224, -409], [-236, -402], [-250, -398],
        [-264, -399], [-275, -405], [-284, -413], [-292, -420], [-303, -422], [-318, -424],
        [-334, -429], [-347, -436],
    ].map((p) => Object.freeze(p))),
    /** The islet off the point (its own closed line), and how high its back stands (u). */
    islet: Object.freeze([
        [-223.5, -433.5], [-215.5, -438.5], [-205, -436], [-202.5, -429.5], [-210.5, -425.5], [-221, -427],
    ].map((p) => Object.freeze(p))),
    isletRise: 1.5,
    /** How far the low noise moves the drawn line in and out (u), and its two scales (u). */
    ragged: Object.freeze([2.4, 1.0]),
    raggedCells: Object.freeze([31, 12]),
    /**
     * The shelf: its width under a rising bank and on the flats (u), its slope there, and the
     * meadow's height over the water at which a bank counts as flat or as rising (u).
     */
    shelf: Object.freeze([3, 14]),
    /** How much a low noise widens and narrows the shelf along the shore (its share either way, doubled). */
    shelfVary: 0.5,
    shelfSlope: Object.freeze([0.16, 0.07]),
    shelfBank: Object.freeze([1.5, 6.5]),
    /** The drop from the shelf to the floor (u across), the floor's depth and its roll (u). */
    drop: 15,
    floor: 3.3,
    roll: 0.9,
    /** The bank: how far the profile reaches into the meadow, and how high the beach rises (u). */
    bank: 34,
    beachRise: 0.9,
    /** One unit of `odysseyTarnRn` beyond the shore, in world units. */
    rnUnit: 48,
    /** The meadow kept open round it (tarn distance): no tree stands nearer, so its banks show. */
    clearing: 1.55,
    /** How far in from its shore the islet's back is risen whole (u). */
    isletReach: 4.5,
    /** The drawn curve's pieces a span (shore, islet), and the profile's noise scales (u). */
    curve: Object.freeze({ per: 6, isletPer: 5 }),
    noise: Object.freeze({ shelfCell: 27, rollCells: Object.freeze([38, 15]), fineRoll: 0.25 }),
});

/** A closed curve through `points` (Catmull-Rom), as a dense polyline: `per` pieces a span. */
function closedCurve(points, per) {
    const n = points.length;
    const out = [];
    const c = (p0, p1, p2, p3, t) => 0.5 * ((2 * p1) + ((p2 - p0) * t)
        + (((2 * p0) - (5 * p1) + (4 * p2) - p3) * t * t)
        + (((3 * p1) - p0 - (3 * p2) + p3) * t * t * t));
    for (let i = 0; i < n; i += 1) {
        const p0 = points[(i - 1 + n) % n];
        const p1 = points[i];
        const p2 = points[(i + 1) % n];
        const p3 = points[(i + 2) % n];
        for (let k = 0; k < per; k += 1) {
            const t = k / per;
            out.push([c(p0[0], p1[0], p2[0], p3[0], t), c(p0[1], p1[1], p2[1], p3[1], t)]);
        }
    }
    return out;
}

/**
 * A closed polyline cut into chunks of consecutive segments, each with its bounding box, so a
 * distance query can skip the chunks that cannot hold the nearest point (the tarn's plate bake
 * asks some hundred thousand of them).
 */
function chunkedPolyline(poly, per = 12) {
    const chunks = [];
    for (let start = 0; start < poly.length; start += per) {
        const end = Math.min(poly.length, start + per);
        let x0 = Infinity;
        let x1 = -Infinity;
        let z0 = Infinity;
        let z1 = -Infinity;
        // Segment k runs from point k - 1 (the last for k = 0) to point k.
        for (let k = start; k < end; k += 1) {
            for (const p of [poly[k], poly[(k - 1 + poly.length) % poly.length]]) {
                x0 = Math.min(x0, p[0]);
                x1 = Math.max(x1, p[0]);
                z0 = Math.min(z0, p[1]);
                z1 = Math.max(z1, p[1]);
            }
        }
        chunks.push({
            start, end, x0, x1, z0, z1,
        });
    }
    return { poly, chunks };
}

/** Signed distance (u) from (x, z) to a chunked closed polyline: negative inside it. */
function polylineDistance(line, x, z) {
    const { poly, chunks } = line;
    const n = poly.length;
    let best = Infinity;
    let inside = false;
    for (let c = 0; c < chunks.length; c += 1) {
        const ch = chunks[c];
        const ox = Math.max(ch.x0 - x, 0, x - ch.x1);
        const oz = Math.max(ch.z0 - z, 0, z - ch.z1);
        const near = (ox * ox) + (oz * oz) < best;
        // A crossing to the right of the point can only come from a chunk that spans its z and
        // reaches past its x.
        const crosses = z >= ch.z0 && z <= ch.z1 && x <= ch.x1;
        if (!near && !crosses) continue;
        for (let k = ch.start; k < ch.end; k += 1) {
            const a = poly[(k - 1 + n) % n];
            const ax = a[0];
            const az = a[1];
            const ex = poly[k][0] - ax;
            const ez = poly[k][1] - az;
            if (near) {
                const t = Math.max(0, Math.min(1, (((x - ax) * ex) + ((z - az) * ez)) / ((ex * ex) + (ez * ez))));
                const dx = x - (ax + (ex * t));
                const dz = z - (az + (ez * t));
                best = Math.min(best, (dx * dx) + (dz * dz));
            }
            if (crosses && (az > z) !== ((az + ez) > z) && x < ((ex * (z - az)) / ez) + ax) inside = !inside;
        }
    }
    return inside ? -Math.sqrt(best) : Math.sqrt(best);
}

/** Smootherstep on 0..1: no kink in the slope at either end. */
function drawnEase(v) {
    const t = Math.max(0, Math.min(1, v));
    return t * t * t * ((t * ((t * 6) - 15)) + 10);
}

/**
 * THE DRAWN WATERS (2026-11-20 the tarn, 2026-11-21 the north lake): a water whose shore is drawn
 * by hand (`outline`, a closed curve through its points, and `islets`), moved a few units in and
 * out by a low noise (`ragged`), with the ground across the shore a profile of the distance to
 * that line:
 *   - under the water a SHELF (the shallows, a gentle slope; wide where the bank lies flat by the
 *     water, narrow under a rising bank), then a `drop` to a floor that rolls (`floor`, `roll`);
 *   - above it a low beach on the same slope, easing over `bank` units into the ground's own;
 *   - on an islet, a low back risen from its shore (`isletRise` over `isletReach`).
 * The profile sets the ground ABSOLUTELY in the water (the waterline is the drawn line itself,
 * whatever the ground there was), and it is exactly the ground's own beyond `bank`. Each water
 * has its own plate (bakeDrawnWaterPlateData), which the shader takes the water from exactly.
 * Built once per water from its frozen spec.
 */
function makeDrawnWater(W) {
    const shore = chunkedPolyline(closedCurve(W.outline, W.curve.per));
    const islets = (W.islets ?? (W.islet ? [W.islet] : []))
        .map((points) => chunkedPolyline(closedCurve(points, W.curve.isletPer)));
    /** How far the ragged line can stand from the drawn one (u). */
    const raggedReach = W.ragged[0] + W.ragged[1];
    /** Beyond this distance from the drawn line nothing of the water is left (u). */
    const reach = W.bank + raggedReach;
    /** The square the profile lives in, [x0, x1, z0, z1]: outside it the ground is its own. */
    const box = Object.freeze(shore.poly.reduce((b, [x, z]) => [
        Math.min(b[0], x - reach), Math.max(b[1], x + reach),
        Math.min(b[2], z - reach), Math.max(b[3], z + reach),
    ], [Infinity, -Infinity, Infinity, -Infinity]));
    const ragged = (x, z) => ((valueNoise((x / W.raggedCells[0]) + 13.1, (z / W.raggedCells[0]) - 41.7) - 0.5) * 2 * W.ragged[0])
        + ((valueNoise((x / W.raggedCells[1]) - 27.4, (z / W.raggedCells[1]) + 8.3) - 0.5) * 2 * W.ragged[1]);
    /**
     * Distance (u) to the waterline, the ragged noise included: negative in the water, positive on
     * land (an islet is land). Outside the box it is the reach plus the way to the box, a lower
     * bound that keeps growing (so a threshold on it can never cover the rest of the island).
     */
    const distance = (x, z) => {
        if (x <= box[0] || x >= box[1] || z <= box[2] || z >= box[3]) {
            return reach + Math.hypot(Math.max(box[0] - x, 0, x - box[1]), Math.max(box[2] - z, 0, z - box[3]));
        }
        const n = ragged(x, z);
        let d = polylineDistance(shore, x, z) + n;
        if (d > 0) return d;
        // In the water: an islet's shore is a waterline too.
        for (let i = 0; i < islets.length; i += 1) d = Math.max(d, -(polylineDistance(islets[i], x, z) + n));
        return d;
    };
    /**
     * The water at (x, z), over the `ground` the rest of the field draws there: the drawn height is
     * `ground * (1 - weight) + target * weight`. In the water and on an islet the weight is 1 and
     * the target is the profile's own height; on the bank the target is the beach and the weight
     * eases from 1 at the waterline to 0 at `bank` units out. Also `d`, the distance to the
     * waterline, and `flat`, how flat the bank lies by the water there (1 on the flats).
     */
    const profile = (x, z, ground) => {
        const d = distance(x, z);
        if (d >= W.bank) {
            return {
                target: ground, weight: 0, d, flat: 0,
            };
        }
        const flat = 1 - smoothstepRange(W.shelfBank[0], W.shelfBank[1], ground - W.waterY);
        const slope = W.shelfSlope[0] + ((W.shelfSlope[1] - W.shelfSlope[0]) * flat);
        const N = W.noise;
        if (d <= 0) {
            const s = -d;
            const shelf = (W.shelf[0] + ((W.shelf[1] - W.shelf[0]) * flat))
                * ((1 - (W.shelfVary / 2)) + (W.shelfVary * valueNoise((x / N.shelfCell) + 3.9, (z / N.shelfCell) - 6.2)));
            const floor = W.floor
                + ((valueNoise((x / N.rollCells[0]) + 5.3, (z / N.rollCells[0]) - 2.1) - 0.5) * 2 * W.roll)
                + ((valueNoise((x / N.rollCells[1]) - 9.7, (z / N.rollCells[1]) + 4.4) - 0.5) * 2 * N.fineRoll);
            const lip = slope * shelf;
            const depth = (slope * Math.min(s, shelf)) + (Math.max(floor - lip, 0) * drawnEase((s - (shelf * 0.7)) / W.drop));
            return {
                target: Math.max(W.waterY - depth, W.floorY), weight: 1, d, flat,
            };
        }
        let target = W.waterY + Math.min(slope * d, W.beachRise);
        let weight = 1 - drawnEase(d / W.bank);
        for (let i = 0; i < islets.length; i += 1) {
            const inIslet = -polylineDistance(islets[i], x, z);
            if (inIslet > -raggedReach) {
                const back = W.waterY + (W.isletRise * smoothstepRange(0, W.isletReach, inIslet + ragged(x, z)));
                if (back > (ground * (1 - weight)) + (target * weight)) {
                    target = back;
                    weight = 1;
                }
            }
        }
        return {
            target, weight, d, flat,
        };
    };
    return {
        shore, islets, reach, box, distance, profile,
    };
}

/** A water's plate: its box at about `texel` u, `resX` across. */
function drawnWaterPlate(box, resX) {
    return Object.freeze({
        box,
        resX,
        resZ: Math.round(resX * ((box[3] - box[2]) / (box[1] - box[0]))),
    });
}

const TARN = makeDrawnWater(ODYSSEY_TARN);
const NORTH_LAKE = makeDrawnWater(ODYSSEY_NORTH_LAKE);

/**
 * The square the tarn's profile lives in, [x0, x1, z0, z1]: outside it the meadow is its own.
 * (The tarn's plate, the water's mesh and the ground's paint read it.)
 */
export const ODYSSEY_TARN_BOX = TARN.box;

/** The drawn shore and the islet's, as dense closed polylines of [x, z] (before the ragged noise). */
export function odysseyTarnLines() {
    return { shore: TARN.shore.poly, islet: TARN.islets[0].poly };
}

/**
 * THE TARN'S PLATE (2026-11-20): the tarn's form at ~0.6 u over ODYSSEY_TARN_BOX, its own small
 * texture (bakeTarnPlateData), texel centres on the box's grid. The ground's shader takes the
 * tarn from it EXACTLY, whatever the macro and relief plates draw under it (see
 * odysseyTarnProfile): before, the tarn's carve rode on the shared sculpt plate as a delta from
 * the analytic ground, and the plates the shader rebuilds that ground from stand up to a unit off
 * it, which on a shelf sloping 1 in 10 moved the waterline by several units, in teeth.
 */
export const ODYSSEY_TARN_PLATE = drawnWaterPlate(ODYSSEY_TARN_BOX, 512);

/**
 * Distance (u) from (x, z) to the tarn's waterline, the ragged noise included: negative in the
 * water, positive on land (the islet is land). Outside the tarn's box it is the reach plus the
 * way to the box, a lower bound that keeps growing (not the true distance).
 * @param {number} x
 * @param {number} z
 */
export function odysseyTarnDistance(x, z) {
    return TARN.distance(x, z);
}

/**
 * Normalized tarn distance: < 1 in the water, 1 on the waterline, `rnUnit` world units a step
 * beyond it (the measure the forest's clearing reads; see odysseyTarnDistance outside the box).
 */
export function odysseyTarnRn(x, z) {
    return 1 + (TARN.distance(x, z) / ODYSSEY_TARN.rnUnit);
}

/**
 * THE TARN AT (x, z), over the `ground` the rest of the field draws there (the drawn waters'
 * profile; ODYSSEY_TARN's numbers).
 * @param {number} x
 * @param {number} z
 * @param {number} ground
 * @returns {{target: number, weight: number, d: number, flat: number}}
 */
export function odysseyTarnProfile(x, z, ground) {
    return TARN.profile(x, z, ground);
}

/**
 * The tarn's carve at (x, z) over a `ground` height there, world units (0 beyond the bank): the
 * profile's height less the ground's (odysseyTarnProfile).
 * @param {number} x
 * @param {number} z
 * @param {number} ground the height the rest of the field draws here
 * @returns {number}
 */
export function odysseyTarnCarve(x, z, ground) {
    const p = TARN.profile(x, z, ground);
    return (p.target - ground) * p.weight;
}

/** The square the north lake's profile lives in, [x0, x1, z0, z1]. */
export const ODYSSEY_NORTH_LAKE_BOX = NORTH_LAKE.box;

/** The north lake's drawn shore and its islets', as dense closed polylines of [x, z]. */
export function odysseyNorthLakeLines() {
    return { shore: NORTH_LAKE.shore.poly, islets: NORTH_LAKE.islets.map((l) => l.poly) };
}

/** The north lake's plate (bakeNorthLakePlateData): ~2.3 u over its box, the tarn's layout. */
export const ODYSSEY_NORTH_LAKE_PLATE = drawnWaterPlate(ODYSSEY_NORTH_LAKE_BOX, 448);

/**
 * Distance (u) from (x, z) to the north lake's waterline: negative in the water, positive on land
 * (the islets are land); outside its box, the reach plus the way to the box.
 * @param {number} x
 * @param {number} z
 */
export function odysseyNorthLakeDistance(x, z) {
    return NORTH_LAKE.distance(x, z);
}

/**
 * Normalized lake distance: < 1 in the water, 1 on the waterline, `rnUnit` (300) world units a
 * step beyond it. THE lake metric: the forest scatter's underwater kill (rn <= 1) and its
 * lakeshore ring (rn 0.95-1.30, from 15 u in the water to 90 u up the bank) read it.
 * @param {number} x
 * @param {number} z
 */
export function odysseyNorthLakeRn(x, z) {
    return 1 + (NORTH_LAKE.distance(x, z) / ODYSSEY_NORTH_LAKE.rnUnit);
}

/**
 * THE NORTH LAKE AT (x, z), over the `ground` the rest of the field draws there (the drawn
 * waters' profile; ODYSSEY_NORTH_LAKE's numbers).
 * @param {number} x
 * @param {number} z
 * @param {number} ground
 * @returns {{target: number, weight: number, d: number, flat: number}}
 */
export function odysseyNorthLakeProfile(x, z, ground) {
    return NORTH_LAKE.profile(x, z, ground);
}

/**
 * The north lake's carve at (x, z) over a `ground` height there (0 beyond its bank).
 * @param {number} x
 * @param {number} z
 * @param {number} ground
 * @returns {number}
 */
export function odysseyNorthLakeCarve(x, z, ground) {
    const p = NORTH_LAKE.profile(x, z, ground);
    return (p.target - ground) * p.weight;
}

/**
 * THE SCULPT PLATE: one ~1.8 u plate (`bakeSculptPlateData`) for the place the 8.8 u relief
 * cannot hold the form the eye needs: the hero summit (odysseySummitSculpt). Its border is
 * outside the summit's reach, so a clamped sampler reads 0 everywhere else. (It carried the tarn
 * too until 2026-11-20; the tarn has its own plate now, ODYSSEY_TARN_PLATE.)
 */
export const ODYSSEY_SCULPT_PLATE = Object.freeze({
    x: -182.7,
    z: -963.0,
    extent: 1180,
    res: 640,
});

/**
 * The sculpted part of the drawn height at (x, z), over the `ground` the macro and relief draw
 * there: the summit's sculpt (the sculpt plate), the tarn's carve and the north lake's (each
 * water's own plate). The waters' boxes lie apart; the lake is laid over the summit's sculpt.
 * @param {number} x
 * @param {number} z
 * @param {number} ground
 * @returns {number}
 */
export function odysseySculptDelta(x, z, ground) {
    const summit = odysseySummitSculpt(x, z);
    return summit + odysseyTarnCarve(x, z, ground) + odysseyNorthLakeCarve(x, z, ground + summit);
}

/**
 * THE drawn surface. Everything that needs to know where the ground is calls this — the vertex
 * shader (via macro + a sampled relief texture), prop seating, and camera grounding. One
 * function, so a tree can never float and a shadow can never disagree with a silhouette.
 */
export function odysseyWorldHeight(x, z) {
    const ground = odysseyWorldMacro(x, z) + (odysseyWorldRelief(x, z) * odysseyWorldDetailWeight(x, z));
    return ground + odysseySculptDelta(x, z, ground);
}

/** Depth of water at a point; negative means dry land. */
export function odysseyWaterDepth(x, z) {
    return ODYSSEY_SEA_LEVEL - odysseyWorldHeight(x, z);
}
