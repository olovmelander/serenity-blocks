/**
 * Verdant Hills — where every tree and every built thing stands.
 *
 * The old oak, the handful of trees placed by hand, the modelled oaks of the middle
 * distance, the sprite trees that carry the hedgerows to the horizon, the drystone wall,
 * the gate, the bench, the outcrops, the kite posts, the windmill and the flock. Nothing
 * here draws: these are plain lists the world's parts build from, and the list the land's
 * baked tree shade is made from.
 *
 * The shade is baked offline into one map that every tier shares, so the layout may not
 * depend on the world's own generator. Each list is planted from a generator of its own,
 * seeded from VERDANT_HILLS_LAYOUT_SEED: the same trees stand in the same places whatever
 * was built before, whichever tier asks, and in the bake. A tier takes a prefix: the field
 * trees are in priority order (and those a tier does not model it draws as sprites, so no
 * shadow lies on the grass without its tree); the far trees are nearest first, so a
 * cheaper tier loses only the farthest.
 */
import { seededRandom } from '../../utils/helpers.js';
import { createVerdantHillsVisibilityTest, verdantHillsInSight } from './verdant-hills-composition.js';
import { VERDANT_HILLS_KITE_STATIONS, VERDANT_HILLS_POST_HEIGHT } from './verdant-hills-kites.js';
import {
    VERDANT_HILLS_PATH, VERDANT_HILLS_PLACES, verdantHillsFieldAt, verdantHillsGroundHeight, verdantHillsNoise,
    verdantHillsWaterDistance,
} from './verdant-hills-terrain.js';

/** Every layout list is planted from `seededRandom(VERDANT_HILLS_LAYOUT_SEED + k)`. */
export const VERDANT_HILLS_LAYOUT_SEED = 4177;
export const VERDANT_HILLS_FIELD_TREE_CEILING = 40;
export const VERDANT_HILLS_FAR_TREE_CEILING = 900;
export const VERDANT_HILLS_SHEEP_CEILING = 60;
/** The static shadow map holds the home hill; past this range a tree's shade is baked into the land. */
export const VERDANT_HILLS_SHADOW_REACH = 70;
/** The land map carries no tree shade beyond this range: nothing so far away shows its shadow. */
export const VERDANT_HILLS_SHADE_HORIZON = 2600;

const DEGREES = 180 / Math.PI;
const TAU = Math.PI * 2;
const {
    eye, oak, mill, gate, bench,
} = VERDANT_HILLS_PLACES;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** Bearing of a place from the lens in degrees: 0 down -Z, positive to the right. */
export function verdantHillsBearing(x, z) {
    return Math.atan2(x - eye.x, eye.z - z) * DEGREES;
}

/** Distance of a place from the lens over the ground, in metres. */
export function verdantHillsRange(x, z) {
    return Math.hypot(x - eye.x, z - eye.z);
}

/** How steep the ground is at a place, in degrees. */
export function verdantHillsSlope(x, z, reach = 1.5) {
    const dx = verdantHillsGroundHeight(x + reach, z) - verdantHillsGroundHeight(x - reach, z);
    const dz = verdantHillsGroundHeight(x, z + reach) - verdantHillsGroundHeight(x, z - reach);
    return Math.atan(Math.hypot(dx, dz) / (2 * reach)) * DEGREES;
}

const MILL_BEARING = verdantHillsBearing(mill.x, mill.z);
const MILL_RANGE = verdantHillsRange(mill.x, mill.z);
/** No trunk stands this close to the windmill's bearing unless it stands behind the mill. */
const MILL_CLEAR_DEGREES = 6;
/** The wind's heading as a turn about Y: a tree turned by this much has its own +X downwind. */
const DOWNWIND_YAW = Math.PI / 3;

/**
 * The modelled trees as the layout needs to know them: height and spread of the crown in
 * metres at scale 1, and the cell of the far-trees sprite sheet that shows the same tree
 * (the sheet holds the three field trees, then the old oak).
 */
export const VERDANT_HILLS_TREE_SHAPES = Object.freeze({
    'oak-hero': Object.freeze({ height: 15.5, spread: 22.5, cell: 3 }),
    'oak-field-a': Object.freeze({ height: 12, spread: 9.3, cell: 0 }),
    'oak-field-b': Object.freeze({ height: 9.5, spread: 9.1, cell: 1 }),
    'oak-field-c': Object.freeze({ height: 14, spread: 8.3, cell: 2 }),
});
export const VERDANT_HILLS_SPRITE_CELLS = Object.freeze(['oak-field-a', 'oak-field-b', 'oak-field-c', 'oak-hero']);
const FIELD_ASSETS = VERDANT_HILLS_SPRITE_CELLS.slice(0, 3);

/**
 * Trees placed by hand. `tone` picks the crown colour along the oak's ramp. The old oak
 * stands on its own terrace at the left edge of the frame; the others keep clear of the
 * windmill's bearing and of the path.
 */
export const VERDANT_HILLS_FEATURE_TREES = Object.freeze([
    // The old oak: its long bough is its own +X, turned a little toward the lens so that it
    // climbs out of the top of the frame rather than crossing the sky the kites fly in.
    {
        asset: 'oak-hero', x: oak.x, z: oak.z, yaw: -0.35, scale: 1, tone: 0.5,
    },
    // By the gate, at the path's edge: its crown leans in over the right-hand rim of the frame.
    {
        asset: 'oak-field-a', x: 30.8, z: -35.9, yaw: 2.2, scale: 1.04, tone: 0.58,
    },
    // Two behind the windmill, one either side of it.
    {
        asset: 'oak-field-c', x: 158.5, z: -233, yaw: 0.7, scale: 1, tone: 0.42, far: true,
    },
    {
        asset: 'oak-field-b', x: 95, z: -250, yaw: DOWNWIND_YAW, scale: 1.1, tone: 0.6, far: true,
    },
    // Two where the left spur runs out, the further one shaped by the wind.
    {
        asset: 'oak-field-a', x: -76.5, z: -97.5, yaw: 4.1, scale: 0.96, tone: 0.48, far: true,
    },
    {
        asset: 'oak-field-b', x: -88.5, z: -116.5, yaw: DOWNWIND_YAW + 0.25, scale: 1.06, tone: 0.66, far: true,
    },
    // One on the nose of the right spur, where the path gives out.
    {
        asset: 'oak-field-c', x: 67.5, z: -99, yaw: 5.3, scale: 0.94, tone: 0.54, far: true,
    },
].map((tree) => Object.freeze(tree)));

/** What a modelled tree needs to stand in for itself as a sprite and to cast a baked shadow. */
function shapeOf(tree) {
    const shape = VERDANT_HILLS_TREE_SHAPES[tree.asset] || VERDANT_HILLS_TREE_SHAPES['oak-field-a'];
    return { cell: shape.cell, height: shape.height * tree.scale, spread: shape.spread * tree.scale };
}

// -- planting ---------------------------------------------------------------------------
/** A grid that answers "does anything already stand within `radius` of here". */
function createSpacing(cell = 16) {
    const cells = new Map();
    const key = (ix, iz) => (ix + 32768) * 65536 + (iz + 32768);
    return {
        add(x, z) {
            const k = key(Math.floor(x / cell), Math.floor(z / cell));
            if (!cells.has(k)) cells.set(k, []);
            cells.get(k).push(x, z);
        },
        crowded(x, z, radius) {
            const reach = Math.ceil(radius / cell);
            const cx = Math.floor(x / cell);
            const cz = Math.floor(z / cell);
            for (let ix = cx - reach; ix <= cx + reach; ix += 1) {
                for (let iz = cz - reach; iz <= cz + reach; iz += 1) {
                    const held = cells.get(key(ix, iz));
                    if (held) {
                        for (let i = 0; i < held.length; i += 2) {
                            if (Math.hypot(held[i] - x, held[i + 1] - z) < radius) return true;
                        }
                    }
                }
            }
            return false;
        },
    };
}

/** A place at a bearing (degrees) and a range from the lens. */
function polar(bearing, range) {
    const turn = bearing / DEGREES;
    return [eye.x + Math.sin(turn) * range, eye.z - Math.cos(turn) * range];
}

/**
 * In front of the windmill as the lens sees it (within its bearing and nearer than it), or
 * so close behind it that a crown would tangle with the sails.
 */
function hidesTheMill(x, z) {
    const off = Math.abs(verdantHillsBearing(x, z) - MILL_BEARING);
    const range = verdantHillsRange(x, z);
    return (off < MILL_CLEAR_DEGREES && range < MILL_RANGE) || (off < 3.6 && range < MILL_RANGE + 150);
}

/** A crown's colour along the ramp: whole hillsides lean one way, each tree a little its own. */
function toneAt(x, z, rng) {
    return clamp(0.5 + (verdantHillsNoise(x / 420, z / 420, 61) - 0.5) * 0.7 + (rng() - 0.5) * 0.36, 0, 1);
}

/** The widest frame's wedge is a little under this many degrees either side of -Z. */
const WEDGE_DEGREES = 52;
/** The side thirds of a 16:9 frame, which the board card leaves in view: bearings either side. */
const SIDE_THIRD = [10.5, 36];
const FIELD_NEAR = 160;
const FIELD_FAR = 620;
const FIELD_SPACING = 16;
const FIELD_WATER = 14;

/** How many places are tried once, from which the field trees are then chosen. */
const FIELD_DRAWS = 9000;

function plantFieldTrees(rng) {
    const visible = createVerdantHillsVisibilityTest();
    const spacing = createSpacing(FIELD_SPACING);
    VERDANT_HILLS_FEATURE_TREES.forEach((tree) => spacing.add(tree.x, tree.z));
    // Places a tree could stand, found in one pass and spread evenly up the screen: on a
    // hedgerow, or well inside a pasture.
    const hedgerows = [];
    const pastures = [];
    for (let draw = 0; draw < FIELD_DRAWS; draw += 1) {
        const bearing = (rng() * 2 - 1) * WEDGE_DEGREES;
        const [x, z] = polar(bearing, FIELD_NEAR * (FIELD_FAR / FIELD_NEAR) ** rng());
        if (!hidesTheMill(x, z) && verdantHillsWaterDistance(x, z) >= FIELD_WATER
            && Math.hypot(x - mill.x, z - mill.z) > 34) {
            const field = verdantHillsFieldAt(x, z);
            if (field.hedge > 0.5) hedgerows.push({ x, z, bearing });
            else if (field.hedge < 0.02 && field.edge > 16 && pastures.length < 1200) pastures.push({ x, z, bearing });
        }
    }
    /** The costly questions, asked of a place only when its turn comes: gentle ground, in the wedge, in sight. */
    const stands = (place) => {
        const spot = place;
        if (spot.stands === undefined) {
            const y = verdantHillsGroundHeight(spot.x, spot.z);
            spot.stands = verdantHillsSlope(spot.x, spot.z) <= 20 && visible(spot.x, y + 6, spot.z, 6)
                // The lower crown, not the tip: a tree worth modelling shows most of itself.
                && verdantHillsInSight(spot.x, y + 4.5, spot.z);
        }
        return spot.stands;
    };
    const beside = (bearing, side) => bearing * side >= SIDE_THIRD[0] && bearing * side <= SIDE_THIRD[1];
    const trees = [];
    for (let slot = 0; slot < VERDANT_HILLS_FIELD_TREE_CEILING; slot += 1) {
        // Two in three stand in a hedgerow; the third stands alone in its pasture.
        const hedgerow = slot % 3 !== 2;
        const pool = hedgerow ? hedgerows : pastures;
        // The first trees of the list stand where a 16:9 frame shows them beside the board,
        // right and left by turns (and on the other side when theirs has no room); the
        // later ones fill the rest of the wedge.
        const side = slot % 2 === 0 ? 1 : -1;
        const wanted = slot < 28 ? [(bearing) => beside(bearing, side), (bearing) => beside(bearing, -side), () => true]
            : [() => true];
        const find = (places) => {
            for (const fits of wanted) {
                const place = places.find((spot) => fits(spot.bearing)
                    && !spacing.crowded(spot.x, spot.z, FIELD_SPACING) && stands(spot));
                if (place) return place;
            }
            return null;
        };
        // The lens sees only so much hedge this close: when it is full, the tree stands in a pasture.
        const place = find(pool) || (hedgerow ? find(pastures) : null);
        if (place) {
            const { x, z } = place;
            const asset = FIELD_ASSETS[Math.floor(rng() * FIELD_ASSETS.length) % FIELD_ASSETS.length];
            // The squat oak was shaped by the wind: its crown leans the way it blows.
            const yaw = asset === 'oak-field-b' ? DOWNWIND_YAW + (rng() - 0.5) * 0.7 : rng() * TAU;
            const tree = {
                asset,
                x,
                z,
                yaw,
                scale: 0.86 + rng() * 0.36,
                tone: toneAt(x, z, rng),
                far: true,
                hedgerow: hedgerows.includes(place),
            };
            trees.push({ ...tree, ...shapeOf(tree) });
            spacing.add(x, z);
        }
    }
    return trees;
}

const FAR_NEAR = 200;
const FAR_FAR = 5200;
const FAR_SPACING = 12;
/** Shares of the far trees: along the hedgerows, in copses on the crests, alone in a pasture. */
const FAR_SHARES = { hedgerow: 0.7, copse: 0.2 };
const COPSES = 12;
const COPSE_RADIUS = 38;

/** How far a place stands above the land around it: its height less the mean 70 m away. */
function prominence(x, z, y = verdantHillsGroundHeight(x, z)) {
    return y - (verdantHillsGroundHeight(x + 70, z) + verdantHillsGroundHeight(x - 70, z)
        + verdantHillsGroundHeight(x, z + 70) + verdantHillsGroundHeight(x, z - 70)) / 4;
}

function plantFarTrees(rng) {
    const visible = createVerdantHillsVisibilityTest();
    const spacing = createSpacing(FAR_SPACING);
    VERDANT_HILLS_FEATURE_TREES.forEach((tree) => spacing.add(tree.x, tree.z));
    // The field trees stand whether a tier models them or draws them as sprites.
    layoutVerdantHillsFieldTrees().forEach((tree) => spacing.add(tree.x, tree.z));
    const trees = [];
    const plant = (x, z, kind, cell) => {
        const name = VERDANT_HILLS_SPRITE_CELLS[cell];
        const shape = VERDANT_HILLS_TREE_SHAPES[name];
        // The old oak's sprite stands for other old open-grown oaks, none as large as the one at home.
        const scale = cell === 3 ? 0.6 + rng() * 0.3 : 0.84 + rng() * 0.34;
        const height = clamp(shape.height * scale, 9, 15);
        trees.push({
            x,
            z,
            height,
            spread: (height * shape.spread) / shape.height,
            cell,
            tone: toneAt(x, z, rng),
            flip: rng() < 0.5,
            phase: rng(),
            kind,
        });
        spacing.add(x, z);
    };
    /**
     * Whether a far tree may stand here: clear of the mill, in the wedge, apart from the
     * others, and not wholly hidden by the land (the top of the shortest is in sight).
     */
    const free = (x, z, y) => !hidesTheMill(x, z) && visible(x, y + 5, z, 10)
        && !spacing.crowded(x, z, FAR_SPACING) && verdantHillsInSight(x, y + 9, z);
    // Somewhere between spread evenly over the ground and spread evenly up the screen:
    // the nearer hedges carry more of the trees, the far ridges are not left bare.
    const somewhere = () => polar((rng() * 2 - 1) * WEDGE_DEGREES, FAR_NEAR + (FAR_FAR - FAR_NEAR) * rng() ** 1.5);

    // Copses first, so the crests are still free: the dozen most prominent crests in sight.
    const crests = [];
    for (let attempt = 0; attempt < 900; attempt += 1) {
        const [x, z] = polar((rng() * 2 - 1) * (WEDGE_DEGREES - 4), 320 + 2900 * rng());
        const y = verdantHillsGroundHeight(x, z);
        if (verdantHillsWaterDistance(x, z) > 60 && !hidesTheMill(x, z) && Math.hypot(x - mill.x, z - mill.z) > 90) {
            const rise = prominence(x, z, y);
            if (rise > 2.2 && verdantHillsInSight(x, y + 6, z)) crests.push({ x, z, rise });
        }
    }
    crests.sort((a, b) => b.rise - a.rise);
    const copses = [];
    for (const crest of crests) {
        if (copses.length < COPSES && copses.every((other) => Math.hypot(other.x - crest.x, other.z - crest.z) > 240)) {
            copses.push(crest);
        }
    }
    const perCopse = Math.round((VERDANT_HILLS_FAR_TREE_CEILING * FAR_SHARES.copse) / COPSES);
    copses.forEach((copse) => {
        for (let made = 0, attempt = 0; made < perCopse && attempt < perCopse * 14; attempt += 1) {
            // Denser at the heart of the copse than at its rim.
            const away = COPSE_RADIUS * Math.sqrt(rng()) * (0.35 + 0.65 * rng());
            const turn = rng() * TAU;
            const x = copse.x + Math.cos(turn) * away;
            const z = copse.z + Math.sin(turn) * away * 0.8;
            const y = verdantHillsGroundHeight(x, z);
            if (verdantHillsWaterDistance(x, z) > 4 && free(x, z, y)) {
                plant(x, z, 'copse', Math.floor(rng() * 3) % 3);
                made += 1;
            }
        }
    });
    const inCopses = trees.length;

    // Hedgerow trees: the oaks and ashes left standing when the hedge was laid.
    const hedgerows = Math.round(VERDANT_HILLS_FAR_TREE_CEILING * FAR_SHARES.hedgerow);
    for (let made = 0, attempt = 0; made < hedgerows && attempt < 90000; attempt += 1) {
        const [x, z] = somewhere();
        if (verdantHillsFieldAt(x, z).hedge > 0.5 && free(x, z, verdantHillsGroundHeight(x, z))) {
            plant(x, z, 'hedgerow', Math.floor(rng() * 3) % 3);
            made += 1;
        }
    }
    const inHedgerows = trees.length - inCopses;

    // The rest stand alone, well inside a pasture; a third of them are old spreading oaks.
    const alone = VERDANT_HILLS_FAR_TREE_CEILING - inCopses - inHedgerows;
    for (let made = 0, attempt = 0; made < alone && attempt < 12000; attempt += 1) {
        const [x, z] = somewhere();
        const field = verdantHillsFieldAt(x, z);
        const open = field.hedge < 0.02 && field.edge > 22 && verdantHillsWaterDistance(x, z) > 10;
        if (open && free(x, z, verdantHillsGroundHeight(x, z))) {
            plant(x, z, 'alone', rng() < 0.34 ? 3 : Math.floor(rng() * 3) % 3);
            made += 1;
        }
    }
    // Nearest first: a tier's prefix drops only the farthest.
    return trees.sort((a, b) => verdantHillsRange(a.x, a.z) - verdantHillsRange(b.x, b.z));
}

const SHEEP_NEAR = 230;
const SHEEP_FAR = 900;

function plantSheep(rng) {
    const visible = createVerdantHillsVisibilityTest();
    const trees = createSpacing(16);
    VERDANT_HILLS_FEATURE_TREES.forEach((tree) => trees.add(tree.x, tree.z));
    layoutVerdantHillsFieldTrees().forEach((tree) => trees.add(tree.x, tree.z));
    layoutVerdantHillsFarTrees().forEach((tree) => {
        if (verdantHillsRange(tree.x, tree.z) < SHEEP_FAR + 40) trees.add(tree.x, tree.z);
    });
    /** Grass a sheep can stand on and be seen: open pasture, dry, not too steep. */
    const pasture = (x, z) => {
        if (verdantHillsWaterDistance(x, z) < 8 || trees.crowded(x, z, 7)) return false;
        const range = verdantHillsRange(x, z);
        if (range < SHEEP_NEAR || range > SHEEP_FAR || Math.hypot(x - mill.x, z - mill.z) < 16) return false;
        const field = verdantHillsFieldAt(x, z);
        if (field.hedge > 0.01 || field.edge < 7 || field.water > 0.01) return false;
        const y = verdantHillsGroundHeight(x, z);
        return verdantHillsSlope(x, z) < 19 && visible(x, y + 0.6, z, 1.2) && verdantHillsInSight(x, y + 0.5, z);
    };
    const flock = [];
    const centres = [];
    for (let group = 0; flock.length < VERDANT_HILLS_SHEEP_CEILING && group < 40; group += 1) {
        const size = Math.min(VERDANT_HILLS_SHEEP_CEILING - flock.length, 3 + Math.floor(rng() * 6));
        // The first groups graze where a 16:9 frame shows them beside the board: the
        // windmill's hill on the right, the valley's near slope on the left.
        const side = group % 2 === 0 ? 1 : -1;
        for (let attempt = 0; attempt < 500; attempt += 1) {
            let bearing = (rng() * 2 - 1) * WEDGE_DEGREES;
            if (group < 8 && attempt < 320) {
                const turn = attempt < 200 ? side : -side;
                bearing = turn * (SIDE_THIRD[0] + (SIDE_THIRD[1] - SIDE_THIRD[0]) * rng());
            }
            // Nearer groups come first: they are the ones that read as sheep.
            const far = group < 4 ? 420 : SHEEP_FAR;
            const [cx, cz] = polar(bearing, SHEEP_NEAR * (far / SHEEP_NEAR) ** rng());
            if (pasture(cx, cz) && centres.every((other) => Math.hypot(other[0] - cx, other[1] - cz) > 46)) {
                centres.push([cx, cz]);
                const heading = rng() * TAU;
                const reach = 3.5 + 2.4 * Math.sqrt(size);
                const members = [];
                for (let made = 0, tries = 0; made < size && tries < size * 30; tries += 1) {
                    const away = reach * Math.sqrt(rng());
                    const turn = rng() * TAU;
                    const x = cx + Math.cos(turn) * away;
                    const z = cz + Math.sin(turn) * away;
                    if (pasture(x, z) && members.every((other) => Math.hypot(other.x - x, other.z - z) > 1.9)) {
                        members.push({
                            x,
                            z,
                            yaw: heading + (rng() - 0.5) * 1.1,
                            scale: 1.14 + rng() * 0.26,
                            // Most have their heads down; one or two in a group are looking about.
                            grazing: rng() < 0.68,
                            group,
                        });
                        made += 1;
                    }
                }
                flock.push(...members);
                break;
            }
        }
    }
    return flock.slice(0, VERDANT_HILLS_SHEEP_CEILING);
}

const cache = {};
/** A layout from the layout's own seed is the same every time: plant it once. */
function planted(name, salt, plant, rng, count, ceiling) {
    const wanted = clamp(Number.isFinite(count) ? Math.floor(count) : ceiling, 0, ceiling);
    if (rng) return plant(rng).slice(0, wanted);
    if (!cache[name]) {
        cache[name] = Object.freeze(plant(seededRandom(VERDANT_HILLS_LAYOUT_SEED + salt)).map(Object.freeze));
    }
    return cache[name].slice(0, wanted);
}

/**
 * The modelled oaks of the middle distance, in priority order: `{ asset, x, z, yaw, scale,
 * tone, far, hedgerow, cell, height, spread }`. Without a generator the list is the
 * layout's own (and the same on every call); a tier models a prefix and draws the rest as
 * sprites from `cell`, `height` and `spread`.
 */
export function layoutVerdantHillsFieldTrees(rng = null, count = VERDANT_HILLS_FIELD_TREE_CEILING) {
    return planted('field', 1, plantFieldTrees, rng, count, VERDANT_HILLS_FIELD_TREE_CEILING);
}

/**
 * The sprite trees of the far hills, nearest first: `{ x, z, height, spread, cell, tone,
 * flip, phase, kind }`. They keep clear of the layout's own field trees whatever generator
 * plants them.
 */
export function layoutVerdantHillsFarTrees(rng = null, count = VERDANT_HILLS_FAR_TREE_CEILING) {
    return planted('far', 2, plantFarTrees, rng, count, VERDANT_HILLS_FAR_TREE_CEILING);
}

/**
 * The flock, group by group: `{ x, z, yaw, scale, grazing, group }`. A sheep faces its own
 * +Z turned by `yaw`; a group heads much the same way.
 */
export function layoutVerdantHillsSheep(rng = null, count = VERDANT_HILLS_SHEEP_CEILING) {
    return planted('sheep', 3, plantSheep, rng, count, VERDANT_HILLS_SHEEP_CEILING);
}

/**
 * What else stands beyond the shadow map and shades the grass as a tree does: the
 * windmill's tower, as the tree whose shadow is nearest the tower's own.
 */
export const VERDANT_HILLS_BUILT_SHADOWS = Object.freeze([
    Object.freeze({
        x: mill.x, z: mill.z, height: 12, spread: 6.5,
    }),
]);

/**
 * Everything whose shade the land map carries, as `{ x, z, height, spread }`: the
 * hand-placed trees beyond the shadow map's reach, all the field trees, the far trees out
 * to the shade horizon, and the windmill. The same list on every tier: hand it to
 * `createVerdantHillsLandData(size, trees)`.
 */
export function verdantHillsTreeShadows({
    features = VERDANT_HILLS_FEATURE_TREES, field = layoutVerdantHillsFieldTrees(), far = layoutVerdantHillsFarTrees(),
    built = VERDANT_HILLS_BUILT_SHADOWS, reach = VERDANT_HILLS_SHADOW_REACH, horizon = VERDANT_HILLS_SHADE_HORIZON,
} = {}) {
    const shade = ({
        x, z, height, spread,
    }) => ({
        x, z, height, spread,
    });
    return [
        ...features.filter((tree) => verdantHillsRange(tree.x, tree.z) > reach)
            .map((tree) => shade({ ...tree, ...shapeOf(tree) })),
        ...field.map(shade),
        ...far.filter((tree) => verdantHillsRange(tree.x, tree.z) <= horizon).map(shade),
        ...built.map(shade),
    ];
}

// -- what people built ------------------------------------------------------------------
/** The path's legs: where each begins, how it runs, how long it is and how far down the path it starts. */
const PATH_LEGS = [];
let PATH_LENGTH = 0;
for (let index = 0; index < VERDANT_HILLS_PATH.length - 1; index += 1) {
    const [ax, az] = VERDANT_HILLS_PATH[index];
    const [bx, bz] = VERDANT_HILLS_PATH[index + 1];
    const length = Math.hypot(bx - ax, bz - az);
    PATH_LEGS.push({
        ax, az, ux: (bx - ax) / length, uz: (bz - az) / length, length, from: PATH_LENGTH,
    });
    PATH_LENGTH += length;
}

/** The point `along` metres down the path and `side` metres to its right (walking away from the lens). */
export function verdantHillsBesidePath(along, side = 0) {
    const leg = PATH_LEGS.find((entry) => along <= entry.from + entry.length) || PATH_LEGS[PATH_LEGS.length - 1];
    const run = along - leg.from;
    return [leg.ax + leg.ux * run - leg.uz * side, leg.az + leg.uz * run + leg.ux * side];
}

/** A corner of the path, moved `side` metres to its right along the bisector of its two legs. */
function besideCorner(index, side) {
    const before = PATH_LEGS[index - 1];
    const after = PATH_LEGS[index];
    const nx = -(before.uz + after.uz);
    const nz = before.ux + after.ux;
    const length = Math.hypot(nx, nz);
    // The bisector is longer than either leg's own offset by the cosine of half the turn.
    const reach = side / ((-before.uz * nx + before.ux * nz) / length);
    return [after.ax + (nx / length) * reach, after.az + (nz / length) * reach];
}

/** Which corner of the path the gate stands on, and how far down the path that is. */
const GATE_CORNER = VERDANT_HILLS_PATH.reduce((best, [x, z], index) => {
    const [bx, bz] = VERDANT_HILLS_PATH[best];
    return Math.hypot(x - gate.x, z - gate.z) < Math.hypot(bx - gate.x, bz - gate.z) ? index : best;
}, 0);
const GATE_ALONG = GATE_CORNER < PATH_LEGS.length ? PATH_LEGS[GATE_CORNER].from : PATH_LENGTH;
/** The path's heading through the gate, and the unit vector to its right. */
const GATE_HEADING = (() => {
    const before = PATH_LEGS[Math.max(0, GATE_CORNER - 1)];
    const after = PATH_LEGS[Math.min(PATH_LEGS.length - 1, GATE_CORNER)];
    const length = Math.hypot(before.ux + after.ux, before.uz + after.uz);
    return { ux: (before.ux + after.ux) / length, uz: (before.uz + after.uz) / length };
})();
const GATE_RIGHT = { x: -GATE_HEADING.uz, z: GATE_HEADING.ux };

/**
 * The windmill stands on its terrace with its cap turned into the wind, which is also very
 * nearly toward the lens: a prop's front is its +Z, and `yaw` turns it about Y. `bed` is
 * how far its base goes into the ground.
 */
export const VERDANT_HILLS_MILL = Object.freeze({
    x: mill.x, z: mill.z, yaw: -Math.PI / 6, bed: 0.15,
});

/** The gate lies across the path, its front up the path toward the lens, hinged on the left. */
export const VERDANT_HILLS_GATE = Object.freeze({
    x: gate.x, z: gate.z, yaw: Math.atan2(-GATE_RIGHT.z, GATE_RIGHT.x), bed: 0.04,
});

/** The bench looks out over the valley, turned a little toward the open side under the oak's bough. */
export const VERDANT_HILLS_BENCH = Object.freeze({
    x: bench.x, z: bench.z, yaw: Math.PI - 0.26, bed: 0.04,
});

/**
 * Limestone the turf never covered: an outcrop under the oak with a smaller one beside
 * it (placed from the oak: on its valley side, right of the swing as the lens sees them,
 * so that neither stands in front of the old wall), and two on the left of the path
 * (placed by how far down the path they lie and how far off it). The modelled outcrops are
 * low pavements, so they are set out larger than life to stand clear of the grass.
 */
export const VERDANT_HILLS_BOULDERS = Object.freeze([
    {
        asset: 'boulder_a', at: [oak.x + 4.6, oak.z - 3.4], yaw: 0.5, scale: 1.5, bed: 0.12,
    },
    {
        asset: 'boulder_c', at: [oak.x + 6, oak.z - 1.4], yaw: 2.3, scale: 1.6, bed: 0.07,
    },
    {
        asset: 'boulder_b', at: verdantHillsBesidePath(13.5, -2.9), yaw: 4.4, scale: 1.5, bed: 0.1,
    },
    {
        asset: 'boulder_c', at: verdantHillsBesidePath(27.5, -2), yaw: 1.1, scale: 1.8, bed: 0.08,
    },
].map(({ at: [x, z], ...stone }) => Object.freeze({ ...stone, x, z })));

/** A post at every kite's station; `height` is where its line is made fast above the ground. */
export const VERDANT_HILLS_POSTS = Object.freeze(VERDANT_HILLS_KITE_STATIONS.map(({ post: [x, z] }, slot) => (
    Object.freeze({
        x, z, yaw: slot * 2.399, height: VERDANT_HILLS_POST_HEIGHT,
    }))));

// -- the drystone wall ------------------------------------------------------------------
/** One section of wall is this long; a run is cut into sections of about this length. */
export const VERDANT_HILLS_WALL_SECTION = 4;
/** The wall keeps this far to the right of the path, and draws in to the gate's post over this much path. */
const WALL_SIDE = 4;
const WALL_AT_GATE = 2.42;
const WALL_DRAWS_IN = 7;
/** How far from the lens the wall begins and ends. */
const WALL_FROM = 12;
const WALL_TO = 110;
/**
 * The gate's posts end this far from its middle; a pier reaches this far past the end of
 * the run it finishes. The cross wall stops a pier short of the left-hand post, so its pier
 * stands against the post, and runs on this far.
 */
const GATE_POST_FACE = 2.15;
const PIER_REACH = 0.58;
const GATE_REACH = GATE_POST_FACE + PIER_REACH;
const CROSS_WALL = 12;
/** A wall's base goes this far into the turf (the model's own footing goes deeper). */
const WALL_BED = 0.03;

/** The wall down the spur: stations along the path, and how far to its right the wall stands at each. */
function rightHandWall() {
    const range = (along) => verdantHillsRange(...verdantHillsBesidePath(along, WALL_SIDE));
    let from = 0;
    while (from < PATH_LENGTH && range(from) < WALL_FROM) from += 0.25;
    let to = PATH_LENGTH;
    while (to > from && range(to) > WALL_TO) to -= 0.25;
    const stations = [[from, WALL_SIDE], [GATE_ALONG - WALL_DRAWS_IN, WALL_SIDE], [GATE_ALONG, WALL_AT_GATE],
        [GATE_ALONG + WALL_DRAWS_IN, WALL_SIDE], [to, WALL_SIDE]];
    // It turns where the path turns, except where it is already drawing in to the gate.
    PATH_LEGS.forEach((leg, corner) => {
        const inside = corner > 0 && leg.from > from + 2 && leg.from < to - 2;
        if (inside && Math.abs(leg.from - GATE_ALONG) > WALL_DRAWS_IN + 2) stations.push([leg.from, WALL_SIDE, corner]);
    });
    return stations.sort((a, b) => a[0] - b[0]).map(([along, side, corner]) => (
        corner ? besideCorner(corner, side) : verdantHillsBesidePath(along, side)));
}

/** A point `away` metres from the middle of the gate along its own line, to the left of the path. */
function leftOfGate(away) {
    return [gate.x - GATE_RIGHT.x * away, gate.z - GATE_RIGHT.z * away];
}

/**
 * The drystone wall as runs of points (x, z); `heads` says which ends of a run are
 * finished with a pier. One wall keeps to the right of the path all the way down the
 * spur, drawing in to the gate's right-hand post as it passes; the gate closes the path;
 * from the gate's other post a cross wall drops away to the left, over the brow. A third,
 * older run comes down the left spur, seen between the bench and the swing, and bends away
 * along the brow.
 */
export const VERDANT_HILLS_WALL = Object.freeze([
    { name: 'spur', points: rightHandWall(), heads: [true, true] },
    { name: 'cross', points: [leftOfGate(GATE_REACH), leftOfGate(GATE_REACH + CROSS_WALL)], heads: [true, true] },
    {
        name: 'left',
        points: [polar(-28.5, 35), polar(-27.4, 47), polar(-25.4, 59), polar(-22.8, 70)],
        heads: [true, true],
    },
].map((run) => Object.freeze({
    ...run, points: Object.freeze(run.points.map(Object.freeze)), heads: Object.freeze(run.heads),
})));

/** A point of a wall's base: on the ground, bedded. */
function footing(x, z) {
    return { x, y: verdantHillsGroundHeight(x, z) - WALL_BED, z };
}

/**
 * The wall as sections that follow the ground: `{ x, y, z, yaw, pitch, stretch, run,
 * from, to }`. A section is the model turned by `yaw` about Y with its length laid from
 * `from` to `to`, both on the ground, and its middle at (x, y, z); `pitch` is the slope of
 * its base and `stretch` its length over the model's own. The homestead rakes it (the
 * base follows the slope, the stones stay plumb) rather than tipping it, so that sections
 * of different pitch meet on an upright joint. Where the ground bulges or dips between the
 * ends of a section, the leg is cut into more, shorter ones.
 */
export function layoutVerdantHillsWall(runs = VERDANT_HILLS_WALL) {
    const sections = [];
    runs.forEach((run) => {
        for (let leg = 0; leg < run.points.length - 1; leg += 1) {
            const [ax, az] = run.points[leg];
            const [bx, bz] = run.points[leg + 1];
            const length = Math.hypot(bx - ax, bz - az);
            const at = (t) => footing(ax + (bx - ax) * t, az + (bz - az) * t);
            /**
             * How badly the straight base of a section misses the ground between its ends: a
             * base that stands clear of a hollow counts in full (the footing hides a hand's
             * breadth, no more), one that a bulge buries counts half.
             */
            const strays = (count) => {
                let worst = 0;
                for (let n = 0; n < count; n += 1) {
                    const a = at(n / count);
                    const b = at((n + 1) / count);
                    for (const t of [0.25, 0.5, 0.75]) {
                        const clear = a.y + (b.y - a.y) * t - at((n + t) / count).y;
                        worst = Math.max(worst, clear, -clear * 0.5);
                    }
                }
                return worst;
            };
            let count = Math.max(1, Math.round(length / VERDANT_HILLS_WALL_SECTION));
            while (strays(count) > 0.14 && length / (count + 1) >= 2.2) count += 1;
            for (let n = 0; n < count; n += 1) {
                const a = at(n / count);
                const b = at((n + 1) / count);
                const span = Math.hypot(b.x - a.x, b.z - a.z);
                sections.push({
                    x: (a.x + b.x) / 2,
                    y: (a.y + b.y) / 2,
                    z: (a.z + b.z) / 2,
                    yaw: Math.atan2(-(b.z - a.z), b.x - a.x),
                    pitch: Math.atan2(b.y - a.y, span),
                    stretch: Math.hypot(span, b.y - a.y) / VERDANT_HILLS_WALL_SECTION,
                    run: run.name,
                    from: a,
                    to: b,
                });
            }
        }
    });
    return sections;
}

/**
 * The piers that finish the free ends of the wall: `{ x, y, z, yaw, run }`. A head stands
 * plumb on the last plane of its run with its own +X pointing away from it.
 */
export function layoutVerdantHillsWallHeads(runs = VERDANT_HILLS_WALL) {
    const heads = [];
    runs.forEach((run) => {
        const last = run.points.length - 1;
        [[0, 1], [last, last - 1]].forEach(([end, inner], which) => {
            if (!run.heads[which]) return;
            const [x, z] = run.points[end];
            const [ix, iz] = run.points[inner];
            heads.push({ ...footing(x, z), yaw: Math.atan2(-(z - iz), x - ix), run: run.name });
        });
    });
    return heads;
}

/** Distance in metres from a point to the nearest run of wall. */
export function verdantHillsWallDistance(x, z, runs = VERDANT_HILLS_WALL) {
    let nearest = Infinity;
    runs.forEach((run) => {
        for (let leg = 0; leg < run.points.length - 1; leg += 1) {
            const [ax, az] = run.points[leg];
            const [bx, bz] = run.points[leg + 1];
            const ux = bx - ax;
            const uz = bz - az;
            const t = clamp(((x - ax) * ux + (z - az) * uz) / (ux * ux + uz * uz), 0, 1);
            nearest = Math.min(nearest, Math.hypot(x - ax - ux * t, z - az - uz * t));
        }
    });
    return nearest;
}
