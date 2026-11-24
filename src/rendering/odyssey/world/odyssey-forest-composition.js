import {
    ODYSSEY_NORTH_BEACH, ODYSSEY_TARN, odysseyNorthBeachAt, odysseyNorthLakeDistance, odysseyTarnDistance, odysseyTarnRn,
} from './odyssey-world-height.js';

/**
 * THE FOREST'S COMPOSITION (2026-11-24): what grows where on the island, and why.
 *
 * The island is seen from a rail that lands on the south coast, crosses a meadow and a tarn and climbs
 * the massif; every wood here is placed for that journey and given a reason in the land:
 *
 *   Landfall     stone pines behind the beach, two groups of them a gate the rail flies through
 *   Greenwood    the closed wood of oak and beech west of the rail, with a skirt of hazel and thorn
 *   Meadow       left open: the horses' grass, a few great oaks alone on it
 *   Waterside    willows and birches on the tarn's far bank and the lake's, in clumps with gaps; on the
 *                islet one bent pine
 *   Blossom      one river of cherry down a fold of the massif's shoulder to the meadow's edge
 *   Goldwood     the east: aspen in clones, each clone turned one colour together, red maples at their
 *                edges, dark islands of spruce between
 *   Slopes       spruce, fir and larch in tongues up the fall line between open chutes, Scots pine on the
 *                ribs, fraying into dwarf pine and silver snags
 *   Taiga        the far west and north: spruce and birch in stands
 *
 * A COMMUNITY says who lives in a wood (canopy, giants, edge, young, shrubs, and who stands alone in its
 * open ground). COVER says how deep into the wood a place is: 0 open grass, ~0.4 the edge, 1 the heart.
 * The scatter (odyssey-forest-scatter.js) reads both and places trees big ones first.
 *
 * Pure arithmetic over a height function, no three.js: the bake worker runs it.
 */

// ── noise ───────────────────────────────────────────────────────────────────────────────────────

/** Deterministic integer hash, 0..1. */
export function hash2(i, j, salt) {
    let h = ((i | 0) * 374761393) + ((j | 0) * 668265263) + (salt * 2654435761);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise, 0..1, on a lattice of `cell` u. */
export function patchNoise(x, z, cell, salt) {
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
    return (((a * (1 - sx)) + (b * sx)) * (1 - sz)) + (((c * (1 - sx)) + (d * sx)) * sz);
}

/** Which cell of a jittered lattice (a stand) a place is in: its hashes, and 0 at its edge .. 1 inside. */
export function standAt(x, z, cell, salt) {
    const wx = x + ((patchNoise(x, z, cell * 0.62, salt + 1) - 0.5) * cell * 0.95)
        + ((patchNoise(x, z, cell * 0.2, salt + 8) - 0.5) * cell * 0.28);
    const wz = z + ((patchNoise(x, z, cell * 0.62, salt + 2) - 0.5) * cell * 0.95)
        + ((patchNoise(x, z, cell * 0.2, salt + 9) - 0.5) * cell * 0.28);
    const gx = Math.floor(wx / cell);
    const gz = Math.floor(wz / cell);
    let d1 = Infinity;
    let d2 = Infinity;
    let bi = 0;
    let bj = 0;
    for (let j = -1; j <= 1; j += 1) {
        for (let i = -1; i <= 1; i += 1) {
            const px = (gx + i + 0.15 + (0.7 * hash2(gx + i, gz + j, salt + 3))) * cell;
            const pz = (gz + j + 0.15 + (0.7 * hash2(gx + i, gz + j, salt + 4))) * cell;
            const d = Math.hypot(wx - px, wz - pz);
            if (d < d1) {
                d2 = d1;
                d1 = d;
                bi = gx + i;
                bj = gz + j;
            } else if (d < d2) d2 = d;
        }
    }
    return {
        a: hash2(bi, bj, salt + 5), b: hash2(bi, bj, salt + 6), c: hash2(bi, bj, salt + 7), inside: Math.min(1, (d2 - d1) / (cell * 0.45)),
    };
}

export const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const smooth = (a, b, v) => {
    const t = clamp01((v - a) / (b - a));
    return t * t * (3 - (2 * t));
};

// ── where the forest may stand ──────────────────────────────────────────────────────────────────

/** The disc the forest fills. */
export const FOREST_DISC = Object.freeze({ cx: -220, cz: -620, radius: 1750 });

/**
 * Air kept clear over the wood: x, z, radius, and the height (world y) no tree's top reaches there. The
 * eagle's thermal at the foot of the wall turns just over the pines.
 */
export const FOREST_CEILINGS = Object.freeze([Object.freeze([-236, -580, 20, 390])]);

/** The massif's summit, which its slopes fall from. */
export const FOREST_MASSIF = Object.freeze({ x: -140, z: -1085 });

/**
 * NO TREE ON THE SAND (owner, 2026-11-24). The ground paints sand from the sea up to a lobed top 2.6-6.7 u
 * over it (the renderer's SEA_BEACH); nothing of the forest, not a bush, has its foot below this, u over
 * the sea, anywhere within `reach` u of the water.
 */
export const FOREST_BEACH = Object.freeze({ top: 8.4, reach: 170 });

/** No tree on the north beach, its dunes or the foot of the bank behind them. */
export function siteOnNorthBeach(x, z) {
    const b = odysseyNorthBeachAt(x, z);
    return !!b && b.wU > 0.05 && b.s < ODYSSEY_NORTH_BEACH.duneBack + 60;
}

/** In a lake's water (by its drawn shore), or on the north beach: nothing may stand here. */
export function siteWet(x, z) {
    if (siteOnNorthBeach(x, z)) return true;
    if (odysseyTarnDistance(x, z) < 1.2) return true;
    return odysseyNorthLakeDistance(x, z) < 1.2;
}

// ── the near island, authored ───────────────────────────────────────────────────────────────────

const mass = (x, z, rx, rz, wood, turn = 0, weight = 1) => Object.freeze({
    x, z, rx, rz, wood, turn, weight,
});

/**
 * THE WOODS ROUND THE JOURNEY, painted as soft shapes (x, z, radii, the community, a turn in radians).
 * Their edges are broken by noise, so none reads as an ellipse.
 */
export const FOREST_MASSES = Object.freeze([
    // the Greenwood: a near wood on the rail's left shoulder, the deep wood west of it, and the tongue
    // of it that comes round the tarn's west end to meet the conifers
    mass(-252, -262, 74, 44, 'greenwood', 0.10),
    mass(-330, -318, 62, 46, 'greenwood', -0.3),
    mass(-432, -288, 118, 70, 'greenwood', 0.12),
    mass(-560, -340, 120, 96, 'greenwood', 0.2),
    mass(-446, -430, 74, 62, 'greenwood', 0.5),
    mass(-690, -300, 120, 80, 'greenwood', 0),
    // the Landfall: pines along the beach's head, in groups
    mass(-230, -224, 18, 13, 'landfall', 0.05),
    mass(-170, -222, 14, 11, 'landfall', 0.05),
    mass(-88, -232, 22, 9, 'landfall', -0.05),
    mass(-318, -222, 44, 13, 'landfall', 0.02),
    mass(-470, -216, 58, 13, 'landfall', 0),
    mass(44, -240, 56, 11, 'landfall', 0),
    mass(190, -234, 70, 13, 'landfall', 0),
    mass(360, -228, 80, 15, 'landfall', 0),
    // the meadow's far side: a copse and the wood behind the beach, east
    mass(88, -268, 74, 20, 'parkwood', 0.05),
    mass(128, -352, 34, 40, 'parkwood', 0.4),
    // the water's far bank, in clumps
    mass(-318, -478, 34, 11, 'waterside', 0.1),
    mass(-252, -480, 15, 8, 'waterside', 0),
    mass(-168, -478, 26, 9, 'waterside', -0.15),
    mass(-120, -420, 12, 16, 'waterside', 0),
    mass(-372, -452, 14, 22, 'waterside', 0.2),
    // the foothills behind the tarn: groves of spruce and birch on the first rise, and the long tongues
    // of forest that climb from them, with lit meadow between
    mass(-398, -512, 44, 22, 'sprucewood', 0.25),
    mass(-330, -540, 22, 40, 'montane', 0.28),
    mass(-344, -628, 24, 62, 'montane', 0.20),
    mass(-452, -588, 34, 78, 'montane', 0.30),
    mass(-486, -700, 40, 80, 'montane', 0.18),
    mass(-560, -560, 52, 44, 'sprucewood', -0.2),
    mass(-620, -668, 60, 90, 'montane', 0.15),
    mass(-272, -560, 17, 46, 'montane', 0.12),
    mass(-276, -668, 20, 52, 'montane', 0.10),
    mass(-112, -528, 24, 15, 'rib', -0.3),
    mass(-66, -584, 22, 30, 'rib', -0.35),
    mass(-10, -640, 26, 40, 'montane', -0.4),
    mass(62, -700, 34, 44, 'montane', -0.5),
    // the near bank: low and open, two clumps at its ends
    mass(-300, -392, 13, 7, 'waterside', 0.2),
    mass(-158, -388, 10, 6, 'waterside', 0),
]);

/** Ground kept open among them (a glade, a view, a path of light). */
export const FOREST_GLADES = Object.freeze([
    // the rail's own corridor, from the beach to the tarn
    mass(-128, -232, 22, 30, 'open', 0.45),
    mass(-168, -320, 26, 60, 'open', 0.35),
    mass(-192, -372, 40, 24, 'open', 0),
    // a ride that opens from the beach into the Greenwood, and a hollow with one oak in it
    mass(-372, -262, 16, 46, 'open', -0.5),
    mass(-430, -346, 42, 22, 'open', 0.3),
    // the chapter 4 hero meadow the rail skirts
    mass(-560, -520, 120, 60, 'open', 0.3),
    // the great meadow east of the rail
    mass(30, -330, 110, 62, 'open', 0),
    mass(-20, -300, 120, 42, 'open', 0),
]);

/**
 * THE BLOSSOM'S RIVER: its course down the fold (x, z, half width), spring to mouth. Trees crowd it, thin
 * at its banks, and a few stand out on the grass beside it.
 */
export const FOREST_BLOSSOM = Object.freeze([
    [214, -742, 15], [196, -690, 20], [160, -640, 24], [132, -596, 30], [104, -556, 36], [80, -520, 42], [52, -486, 44], [14, -466, 34],
]);

const hero = (id, x, z, scale, rot, clear) => Object.freeze({
    id, x, z, scale, rot, clear,
});

/**
 * THE HEROES: single trees placed by hand. They stand whatever the dice say (but never in water), at
 * their own size and turn, and nothing crowds them (`clear`, u).
 */
export const FOREST_HEROES = Object.freeze([
    // the Landfall's gate: pines leaning to the sea on the left, a group on the right
    hero('stone-pine-old', -177, -219, 1.12, 2.6, 9),
    hero('stone-pine-tall', -224, -221, 1, 0.8, 6),
    hero('stone-pine-young', -168, -229, 1.1, 4.1, 4),
    hero('stone-pine-tall', -93, -229, 1.08, 5.2, 8),
    hero('stone-pine-old', -79, -236, 0.92, 3.9, 7),
    hero('stone-pine-young', -103, -235, 0.9, 1, 3),
    // the meadow's trees, alone on the grass
    hero('oak-great', -112, -292, 1.1, 0.9, 22),
    hero('oak-wide', 44, -302, 1.12, 2.2, 18),
    hero('oak-great', 74, -402, 1, 4.4, 20),
    hero('birch-clump', 12, -270, 1, 1.2, 10),
    // the Greenwood's edge by the rail, and the oak in its hollow
    hero('oak-great', -206, -266, 1.15, 5.5, 11),
    hero('beech-tall', -226, -304, 1.12, 1.8, 8),
    hero('oak-great', -428, -344, 1.2, 2.9, 16),
    // the tarn: the islet's bent pine, a willow at each end, birches and a maple on the far bank
    hero('bent-pine', -206.2, -430.6, 1.1, 0.5, 4),
    hero('willow-old', -374, -466, 1.18, 0.4, 10),
    hero('willow-old', -119, -450, 1.05, 2.2, 9),
    hero('willow-round', -296, -472, 1.1, 4, 7),
    hero('birch-clump', -244, -476, 1.1, 2.8, 6),
    hero('birch-one', -186, -474, 1.1, 0.3, 4),
    hero('maple-spread', -150, -470, 1.05, 1.4, 8),
    // the climb's gate: old larches and Scots pines each side of the rail, bent pines and a snag on the rib above
    hero('larch-old', -246, -520, 1.18, 1, 8),
    hero('larch-tall', -258, -512, 1, 3.3, 5),
    hero('scots-old', -184, -516, 1.15, 2.4, 8),
    hero('scots-tall', -172, -528, 1, 0.6, 5),
    hero('spruce-great', -282, -540, 1.12, 2, 6),
    hero('bent-pine', -196, -566, 1.2, 3.6, 5),
    hero('snag-tall', -232, -572, 1, 0.2, 5),
    hero('bent-pine', -158, -604, 1.1, 5, 5),
    // the blossom's mouth at the meadow's edge, and its spring up the fold
    hero('cherry-queen', 6, -458, 1.15, 0.2, 11),
    hero('cherry-queen', 74, -508, 1, 3.1, 9),
    hero('cherry-cloud', -20, -452, 1, 2.6, 7),
    hero('spruce-great', 122, -642, 1.1, 1.1, 6),
]);

/** The dark poplar-like notes: a cypress row on the gold side's seaward rise. */
export const FOREST_CYPRESS_ROWS = Object.freeze([
    Object.freeze({
        x0: 232, z0: -262, x1: 330, z1: -300, count: 9,
    }),
    Object.freeze({
        x0: -640, z0: -236, x1: -716, z1: -246, count: 6,
    }),
]);

// ── communities ─────────────────────────────────────────────────────────────────────────────────

const C = (spec) => Object.freeze(spec);
/** Who lives in each wood: [specimen, weight] lists by role. */
export const FOREST_COMMUNITIES = Object.freeze({
    greenwood: C({
        giant: [['oak-great', 1], ['beech-tall', 1]],
        canopy: [['oak-tall', 4], ['beech-tall', 3.2], ['beech-dome', 2.4], ['oak-wide', 1.2], ['birch-one', 0.5]],
        edge: [['oak-wide', 2], ['beech-dome', 1.6], ['birch-one', 1.2], ['birch-clump', 0.8], ['oak-young', 1.6], ['hazel', 1.2]],
        young: [['oak-young', 2], ['beech-young', 2], ['birch-young', 1]],
        shrub: [['hazel', 3], ['thicket', 2], ['hawthorn', 1]],
        open: [['oak-wide', 1.2], ['birch-clump', 0.8], ['hawthorn', 2.2], ['thicket', 2], ['oak-young', 1]],
        patch: 62,
    }),
    parkwood: C({
        giant: [['oak-great', 1]],
        canopy: [['oak-wide', 2.4], ['oak-tall', 1.6], ['beech-dome', 1.6], ['birch-one', 1.4], ['birch-clump', 1.0]],
        edge: [['birch-one', 1.4], ['birch-clump', 1.2], ['oak-young', 1.5], ['hawthorn', 1.4], ['hazel', 1.2]],
        young: [['oak-young', 1.5], ['birch-young', 1.5]],
        shrub: [['hawthorn', 2], ['thicket', 2], ['hazel', 1.5]],
        open: [['hawthorn', 2], ['thicket', 2], ['birch-young', 1], ['oak-wide', 0.8]],
        patch: 48,
    }),
    landfall: C({
        giant: [['stone-pine-old', 1]],
        canopy: [['stone-pine-tall', 2.4], ['stone-pine-old', 1.6], ['stone-pine-young', 1.4]],
        edge: [['stone-pine-young', 2], ['juniper', 2], ['thicket', 1]],
        young: [['stone-pine-young', 2], ['juniper', 1]],
        shrub: [['thicket', 2.4], ['juniper', 2]],
        open: [['juniper', 2], ['thicket', 2], ['stone-pine-young', 0.6]],
        patch: 40,
    }),
    waterside: C({
        giant: [['willow-old', 1]],
        canopy: [['birch-one', 2.2], ['birch-clump', 1.8], ['willow-round', 1.6], ['willow-old', 0.8], ['aspen-broad', 0.0]],
        edge: [['birch-young', 1.4], ['willow-round', 1.0], ['hazel', 1.4], ['birch-clump', 0.8]],
        young: [['birch-young', 2], ['oak-young', 0.5]],
        shrub: [['thicket', 2.4], ['hazel', 1.4]],
        open: [['thicket', 1.6], ['birch-young', 1]],
        patch: 36,
    }),
    blossom: C({
        giant: [['cherry-queen', 1]],
        canopy: [['cherry-vase', 2.6], ['cherry-cloud', 2.2], ['cherry-queen', 1.0]],
        edge: [['cherry-young', 2], ['cherry-vase', 1.4], ['cherry-cloud', 1.0]],
        young: [['cherry-young', 2]],
        shrub: [['thicket', 1], ['hawthorn', 0.8]],
        open: [['cherry-vase', 1.4], ['cherry-young', 2], ['cherry-cloud', 0.8], ['hawthorn', 0.8]],
        patch: 40,
    }),
    aspen: C({
        giant: [['aspen-broad', 1]],
        canopy: [['aspen-tall', 3.4], ['aspen-broad', 2.2]],
        edge: [['aspen-young', 2.4], ['aspen-broad', 1], ['aspen-tall', 0.6]],
        young: [['aspen-young', 2]],
        shrub: [['thicket', 2], ['hazel', 1]],
        open: [['aspen-young', 1], ['aspen-broad', 0.8], ['thicket', 1.4], ['maple-spread', 0.3]],
        patch: 90,
    }),
    maple: C({
        giant: [['maple-round', 1]],
        canopy: [['maple-round', 2.2], ['maple-spread', 1.6]],
        edge: [['maple-spread', 1.6], ['aspen-young', 1]],
        young: [['maple-spread', 1], ['aspen-young', 1]],
        shrub: [['thicket', 2], ['hazel', 1]],
        open: [['maple-spread', 1], ['thicket', 1]],
        patch: 80,
    }),
    sprucewood: C({
        giant: [['spruce-great', 1]],
        canopy: [['spruce-spire', 3], ['spruce-broad', 2.2], ['spruce-great', 1], ['fir-tall', 2]],
        edge: [['spruce-young', 2.4], ['spruce-broad', 1.4], ['birch-one', 0.5], ['birch-young', 0.5]],
        young: [['spruce-young', 2], ['fir-young', 1.4]],
        shrub: [['thicket', 1.2], ['juniper', 1.4]],
        open: [['spruce-young', 1.4], ['juniper', 1.4], ['birch-one', 0.4], ['spruce-broad', 0.6]],
        patch: 70,
    }),
    montane: C({
        giant: [['spruce-great', 2], ['larch-old', 1]],
        canopy: [['spruce-spire', 3.2], ['fir-tall', 2.4], ['spruce-broad', 1.6], ['larch-tall', 1.8], ['spruce-great', 0.8], ['scots-tall', 0.7]],
        edge: [['spruce-young', 2.2], ['fir-young', 1.6], ['larch-tall', 1.2], ['scots-young', 0.8], ['birch-one', 0.4]],
        young: [['spruce-young', 2], ['fir-young', 2]],
        shrub: [['juniper', 2], ['dwarf-pine-b', 1]],
        open: [['juniper', 1.4], ['spruce-young', 1], ['scots-old', 0.6], ['larch-old', 0.4], ['dwarf-pine-b', 0.6], ['snag-stub', 0.2]],
        patch: 66,
    }),
    rib: C({
        giant: [['scots-old', 1]],
        canopy: [['scots-tall', 2], ['scots-old', 1.6], ['larch-old', 0.8], ['larch-tall', 0.8]],
        edge: [['scots-young', 2], ['juniper', 1.2], ['dwarf-pine-b', 0.8]],
        young: [['scots-young', 2], ['juniper', 1]],
        shrub: [['juniper', 2], ['dwarf-pine-b', 1.4]],
        open: [['scots-old', 1], ['juniper', 1.6], ['dwarf-pine-a', 0.8], ['snag-tall', 0.3]],
        patch: 52,
    }),
    treeline: C({
        giant: [['larch-old', 1]],
        canopy: [['spruce-young', 2.4], ['larch-old', 1], ['dwarf-pine-a', 2.2], ['spruce-spire', 0.6], ['snag-tall', 0.35]],
        edge: [['dwarf-pine-a', 2.4], ['dwarf-pine-b', 2], ['spruce-young', 1], ['snag-stub', 0.3]],
        young: [['dwarf-pine-b', 2], ['spruce-young', 1]],
        shrub: [['dwarf-pine-b', 2], ['juniper', 1]],
        open: [['dwarf-pine-a', 2], ['dwarf-pine-b', 2], ['snag-tall', 0.25], ['bent-pine', 0.2]],
        patch: 50,
    }),
    taiga: C({
        giant: [['spruce-great', 1]],
        canopy: [['spruce-spire', 3], ['fir-tall', 1.6], ['spruce-broad', 1.6], ['birch-one', 1.1], ['scots-tall', 0.9]],
        edge: [['birch-one', 1.6], ['spruce-young', 2], ['birch-young', 1]],
        young: [['spruce-young', 2], ['birch-young', 1]],
        shrub: [['thicket', 1], ['juniper', 1]],
        open: [['birch-clump', 0.8], ['spruce-young', 1], ['scots-old', 0.5]],
        patch: 120,
    }),
});

// ── the ground's reading ────────────────────────────────────────────────────────────────────────

/** The gold side's axis across the island, its seam and how wide it hands over. */
const GOLD = Object.freeze({
    axis: [0.891, -0.455], split: 300, feather: 170, wanderCell: 420, wanderAmp: 210,
});

/** 0 the green west .. 1 the gold east, the seam wandering. */
export function forestGoldAt(x, z) {
    const wander = (patchNoise(x, z, GOLD.wanderCell, 91) - 0.5) * GOLD.wanderAmp;
    const along = (x * GOLD.axis[0]) + (z * GOLD.axis[1]);
    return clamp01(((along - (GOLD.split + wander)) / GOLD.feather) + 0.5);
}

/** Distance into the blossom's river at (x, z): 1 on its course, 0 at its banks, below 0 outside (in half widths). */
export function forestBlossomAt(x, z) {
    let best = -Infinity;
    for (let i = 0; i + 1 < FOREST_BLOSSOM.length; i += 1) {
        const [ax, az, aw] = FOREST_BLOSSOM[i];
        const [bx, bz, bw] = FOREST_BLOSSOM[i + 1];
        const dx = bx - ax;
        const dz = bz - az;
        const t = clamp01((((x - ax) * dx) + ((z - az) * dz)) / ((dx * dx) + (dz * dz)));
        const d = Math.hypot(x - (ax + (dx * t)), z - (az + (dz * t)));
        const w = aw + ((bw - aw) * t);
        best = Math.max(best, 1 - (d / w));
    }
    if (best < -3) return best;
    // Broad swings of its banks, bays of grass across it, and ragged edges.
    return best + ((patchNoise(x, z, 58, 303) - 0.5) * 1.25) + ((patchNoise(x, z, 26, 301) - 0.5) * 0.75)
        + ((patchNoise(x, z, 11, 302) - 0.5) * 0.3);
}

/** A soft shape's reading: 1 at its middle, 0 at its edge, below 0 outside. */
function inMass(m, x, z) {
    const dx = x - m.x;
    const dz = z - m.z;
    const c = Math.cos(m.turn);
    const s = Math.sin(m.turn);
    const u = ((dx * c) + (dz * s)) / m.rx;
    const v = ((dz * c) - (dx * s)) / m.rz;
    return 1 - Math.sqrt((u * u) + (v * v));
}

/**
 * The land's reading at a place: which community, and how deep into the wood it is.
 * @param {number} x
 * @param {number} z
 * @param {number} y      the ground's height
 * @param {number} slope  its slope
 * @param {number} hollow how hollow it is (positive in a fold, negative on a rib), per u
 * @param {number} shore  distance to the sea
 * @param {number} dRail  distance to the rail's track
 * @returns {{wood: string, cover: number}}
 */
export function forestGroundAt(x, z, y, slope, hollow, shore, dRail) {
    const broken = ((patchNoise(x, z, 52, 201) - 0.5) * 0.62) + ((patchNoise(x, z, 19, 202) - 0.5) * 0.26);
    const warpY = (patchNoise(x, z, 110, 203) - 0.5) * 34;

    // ── the water's edges ──
    const tarn = odysseyTarnDistance(x, z);
    const lake = odysseyNorthLakeDistance(x, z);

    // ── the blossom's river ──
    const blossom = forestBlossomAt(x, z);
    if (blossom > -1.6 && slope < 0.66) {
        if (blossom > 0) return { wood: 'blossom', cover: clamp01(0.26 + (blossom * 0.92)) };
        // its banks: stray cherries thinning out over the grass, then the land's own
        if (blossom > -1.1) return { wood: 'blossom', cover: clamp01(0.10 + (0.14 * (1 + (blossom / 1.1)))) };
    }

    // ── the slopes ──
    const mx = x - FOREST_MASSIF.x;
    const mz = z - FOREST_MASSIF.z;
    const rho = Math.hypot(mx, mz);
    const around = Math.atan2(mz, mx) * Math.max(rho, 200);
    const flank = smooth(328, 356, y + warpY) * smooth(1250, 950, rho);
    if (flank > 0.5) {
        // Tongues of forest up the fall line between chutes; they close into one wood lower down.
        const lane = (patchNoise(around + ((patchNoise(x, z, 160, 205) - 0.5) * 44), rho * 0.16, 62, 206) * 0.72)
            + (patchNoise(around, rho * 0.3, 27, 207) * 0.28);
        const top = 452 + ((patchNoise(around, rho * 0.05, 105, 208) - 0.5) * 120) + (clamp01(hollow * 30) * 26);
        const up = (top - y) / 64;
        const low = smooth(402, 346, y);
        const tongue = smooth(0.36 - (0.14 * low), 0.57 - (0.12 * low), lane + (clamp01(hollow * 26) * 0.16) - (clamp01(-hollow * 26) * 0.06));
        const steep = 1 - smooth(0.66, 0.92, slope);
        const meadow = smooth(0.74, 0.60, patchNoise(x, z, 150, 209) + (low * 0.04));
        let cover = (tongue * clamp01(up) * steep * mixTo(1, meadow, low)) + (broken * 0.22);
        let rib = hollow < -0.006 && slope > 0.30;
        for (let i = 0; i < FOREST_MASSES.length; i += 1) {
            const m = FOREST_MASSES[i];
            if (m.wood !== 'montane' && m.wood !== 'rib' && m.wood !== 'sprucewood') continue;
            const k = inMass(m, x, z);
            if (k < -0.6) continue;
            const c = clamp01(((k + (broken * 0.7)) * 1.35) + 0.30) * clamp01(up + 0.35) * steep;
            if (c > cover) {
                cover = c;
                rib = m.wood === 'rib';
            }
        }
        if (y > top - 46) {
            // The treeline: islands of dwarf pine and stunted spruce, thinning up to a hard roof.
            const fringe = clamp01((top + 92 - y) / 110) * smooth(0.42, 0.62, lane * 0.6 + (patchNoise(x, z, 38, 210) * 0.4))
                * (1 - smooth(1.02, 1.28, slope));
            return { wood: 'treeline', cover: clamp01(Math.max(cover * 0.8, fringe * 0.62)) };
        }
        // The gold reaches a little way up the eastern flank, the spruce has the rest.
        const gold = forestGoldAt(x, z);
        if (gold > 0.72 && y < 388 + warpY && slope < 0.5) {
            return { wood: patchNoise(x, z, 84, 211) > 0.42 ? 'aspen' : 'sprucewood', cover: clamp01(cover) };
        }
        return { wood: rib ? 'rib' : 'montane', cover: clamp01(cover) };
    }

    // ── the coast ──
    const beach = smooth(70, 44, shore + (broken * 30));
    const near = smooth(640, 430, dRail);

    // ── the authored woods round the journey ──
    let cover = -1;
    let wood = 'greenwood';
    if (near > 0) {
        for (let i = 0; i < FOREST_MASSES.length; i += 1) {
            const m = FOREST_MASSES[i];
            const k = inMass(m, x, z);
            if (k < -0.8) continue;
            const c = k + (broken * (0.55 + (0.25 * Math.min(1, Math.min(m.rx, m.rz) / 60))));
            if (c > cover) {
                cover = c;
                ({ wood } = m);
            }
        }
        for (let i = 0; i < FOREST_GLADES.length; i += 1) {
            const k = inMass(FOREST_GLADES[i], x, z) + (broken * 0.4);
            if (k > 0) cover -= k * 2.2;
        }
        cover = clamp01((cover * 1.35) + 0.30);
        if (cover <= 0.02) cover = 0.05;
    }

    // ── beyond them: the land's own stands ──
    const gold = forestGoldAt(x, z);
    const woods = (patchNoise(x, z, 330, 221) * 0.58) + (patchNoise(x, z, 128, 222) * 0.42) + (clamp01(hollow * 30) * 0.08);
    let wildCover;
    let wildWood;
    if (lake < 46 && lake > 0) {
        wildWood = 'waterside';
        wildCover = smooth(0.40, 0.62, patchNoise(x, z, 74, 224)) * 0.9;
    } else if (beach > 0.4) {
        wildWood = 'landfall';
        wildCover = smooth(0.48, 0.70, patchNoise(x, z, 92, 225) + (broken * 0.2)) * 0.85;
    } else if (gold > 0.5) {
        // A clone turns together: a stand is one colour, and some stands are something else.
        const stand = standAt(x, z, 104, 231);
        if (stand.a < 0.17) wildWood = 'sprucewood';
        else if (stand.a < 0.30) wildWood = 'maple';
        else wildWood = 'aspen';
        const gap = stand.b < 0.16 ? 0 : 1;
        wildCover = clamp01(smooth(0.36, 0.56, woods) * gap * (0.45 + (0.75 * stand.inside)) + (broken * 0.25));
    } else if (x < -900 || z < -1250) {
        wildWood = 'taiga';
        wildCover = clamp01(smooth(0.46, 0.64, woods) + (broken * 0.25));
    } else {
        wildWood = 'greenwood';
        wildCover = clamp01(smooth(0.43, 0.60, woods) + (broken * 0.25));
    }
    if (near > 0) {
        // The authored woods hand over to the wild ones across the edge of the near ground. East of the
        // seam they give way sooner, so the gold stands come up to the meadow.
        const give = Math.max(1 - near, smooth(0.35, 0.75, gold));
        if (give >= 0.5 || cover < 0.06) {
            const c = (cover * (1 - give)) + (wildCover * give);
            return { wood: give >= 0.5 ? wildWood : wood, cover: clamp01(c) };
        }
        return { wood: tarn < 34 && cover < 0.5 && wood !== 'waterside' ? 'waterside' : wood, cover: clamp01(cover) };
    }
    return { wood: wildWood, cover: clamp01(wildCover) };
}

function mixTo(a, b, t) {
    return a + ((b - a) * t);
}

/** The tarn's open meadow: only what is authored stands here, so the water shows from the rail. */
export function forestTarnOpen(x, z, y) {
    return y <= ODYSSEY_TARN.waterY + 30 && odysseyTarnRn(x, z) <= ODYSSEY_TARN.clearing;
}
