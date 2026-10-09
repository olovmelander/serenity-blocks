import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    createVerdantHillsVisibilityTest, verdantHillsInSight,
} from '../../src/themes/verdant-hills/verdant-hills-composition.js';
import {
    VERDANT_HILLS_KITE_STATIONS, VERDANT_HILLS_POST_HEIGHT,
} from '../../src/themes/verdant-hills/verdant-hills-kites.js';
import {
    VERDANT_HILLS_BENCH, VERDANT_HILLS_BOULDERS, VERDANT_HILLS_BUILT_SHADOWS, VERDANT_HILLS_FAR_TREE_CEILING,
    VERDANT_HILLS_FEATURE_TREES, VERDANT_HILLS_FIELD_TREE_CEILING, VERDANT_HILLS_GATE, VERDANT_HILLS_LAYOUT_SEED,
    VERDANT_HILLS_MILL, VERDANT_HILLS_POSTS, VERDANT_HILLS_SHADE_HORIZON, VERDANT_HILLS_SHADOW_REACH,
    VERDANT_HILLS_SHEEP_CEILING, VERDANT_HILLS_SPRITE_CELLS, VERDANT_HILLS_TREE_SHAPES, VERDANT_HILLS_WALL,
    VERDANT_HILLS_WALL_SECTION, layoutVerdantHillsFarTrees, layoutVerdantHillsFieldTrees, layoutVerdantHillsSheep,
    layoutVerdantHillsWall, layoutVerdantHillsWallHeads, verdantHillsBearing, verdantHillsBesidePath,
    verdantHillsRange, verdantHillsSlope, verdantHillsTreeShadows, verdantHillsWallDistance,
} from '../../src/themes/verdant-hills/verdant-hills-layout.js';
import { VERDANT_HILLS_WIND_DIRECTION } from '../../src/themes/verdant-hills/verdant-hills-light.js';
import { VERDANT_HILLS_TIERS } from '../../src/themes/verdant-hills/verdant-hills-quality.js';
import {
    VERDANT_HILLS_PATH, VERDANT_HILLS_PLACES, VERDANT_HILLS_TERRACES, verdantHillsFieldAt, verdantHillsGroundHeight,
    verdantHillsPathDistance, verdantHillsWaterDistance,
} from '../../src/themes/verdant-hills/verdant-hills-terrain.js';
import { seededRandom } from '../../src/utils/helpers.js';

/** Dearest first: what a tier draws may only shrink along this list. */
const TIERS = ['Extreme', 'Ultra', 'High', 'Medium', 'Low', 'Minimal'];
// Planting the far trees walks a few tens of thousands of places; a busy machine takes its time.
const SLOW = 120000;
const {
    oak, mill, gate, bench,
} = VERDANT_HILLS_PLACES;
const MILL_BEARING = verdantHillsBearing(mill.x, mill.z);
const MILL_RANGE = verdantHillsRange(mill.x, mill.z);
/** The gate's stone posts stand this far either side of its middle, and are this thick. */
const GATE_POST = 1.925;
const GATE_POST_SIZE = 0.45;
/** Half the wall's thickness at its foot, and how far a pier reaches past the end of the run it finishes. */
const WALL_HALF = 0.3;
const PIER_REACH = 0.58;

const visible = createVerdantHillsVisibilityTest();
const ground = (place) => verdantHillsGroundHeight(place.x, place.z);
const range = (place) => verdantHillsRange(place.x, place.z);
const bearing = (place) => verdantHillsBearing(place.x, place.z);
const apart = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const at = (place) => `${place.x.toFixed(1)}, ${place.z.toFixed(1)}`;
const heightOf = (tree) => tree.height ?? VERDANT_HILLS_TREE_SHAPES[tree.asset].height * tree.scale;

/** The nearest two of a list stand this far apart. */
function closest(places, others = places) {
    let nearest = Infinity;
    places.forEach((a) => others.forEach((b) => { if (a !== b) nearest = Math.min(nearest, apart(a, b)); }));
    return nearest;
}

/** A point of the gate's own line: `away` metres from its middle toward its +X (the right of the path). */
function alongGate(away) {
    return {
        x: gate.x + Math.cos(VERDANT_HILLS_GATE.yaw) * away, z: gate.z - Math.sin(VERDANT_HILLS_GATE.yaw) * away,
    };
}

/** The way a prop's front (+Z) faces once it is turned by `yaw` about Y. */
const facing = (yaw) => ({ x: Math.sin(yaw), z: Math.cos(yaw) });

/** Sheep by group, in the order the groups were planted. */
function grouped(flock) {
    const groups = new Map();
    flock.forEach((sheep) => {
        if (!groups.has(sheep.group)) groups.set(sheep.group, []);
        groups.get(sheep.group).push(sheep);
    });
    return [...groups.values()];
}

describe('Verdant Hills layout: one planting for every tier and for the bake', () => {
    it('plants each list from its own generator of the layout seed, the same every time', () => {
        expect(Number.isInteger(VERDANT_HILLS_LAYOUT_SEED)).toBe(true);
        const field = layoutVerdantHillsFieldTrees();
        const far = layoutVerdantHillsFarTrees();
        const sheep = layoutVerdantHillsSheep();
        expect(field).toHaveLength(VERDANT_HILLS_FIELD_TREE_CEILING);
        expect(far).toHaveLength(VERDANT_HILLS_FAR_TREE_CEILING);
        expect(sheep).toHaveLength(VERDANT_HILLS_SHEEP_CEILING);
        // Asked again, in another order, with nothing passed: the same trees in the same places.
        expect(layoutVerdantHillsSheep()).toEqual(sheep);
        expect(layoutVerdantHillsFarTrees()).toEqual(far);
        expect(layoutVerdantHillsFieldTrees()).toEqual(field);
        // A fresh generator from the seed plants the same list, whatever was planted before it.
        expect(layoutVerdantHillsFarTrees(seededRandom(VERDANT_HILLS_LAYOUT_SEED + 2))).toEqual(far);
        expect(layoutVerdantHillsSheep(seededRandom(VERDANT_HILLS_LAYOUT_SEED + 3))).toEqual(sheep);
        expect(layoutVerdantHillsFieldTrees(seededRandom(VERDANT_HILLS_LAYOUT_SEED + 1))).toEqual(field);
        // What is handed out cannot be scribbled on by one part to the surprise of another.
        expect(Object.isFrozen(field[0])).toBe(true);
        expect(Object.isFrozen(far[0])).toBe(true);
        expect(Object.isFrozen(sheep[0])).toBe(true);
        expect(layoutVerdantHillsFieldTrees()).not.toBe(field);
    }, SLOW);

    it('hands a tier a prefix of each list, and nothing for a count that makes no sense', () => {
        const field = layoutVerdantHillsFieldTrees();
        const far = layoutVerdantHillsFarTrees();
        const sheep = layoutVerdantHillsSheep();
        for (const name of TIERS) {
            const tier = VERDANT_HILLS_TIERS[name];
            expect(layoutVerdantHillsFieldTrees(null, tier.fieldTrees), name).toEqual(field.slice(0, tier.fieldTrees));
            expect(layoutVerdantHillsFarTrees(null, tier.farTrees), name).toEqual(far.slice(0, tier.farTrees));
            expect(layoutVerdantHillsSheep(null, tier.sheep), name).toEqual(sheep.slice(0, tier.sheep));
            expect(tier.fieldTrees).toBeLessThanOrEqual(VERDANT_HILLS_FIELD_TREE_CEILING);
            expect(tier.farTrees).toBeLessThanOrEqual(VERDANT_HILLS_FAR_TREE_CEILING);
            expect(tier.sheep).toBeLessThanOrEqual(VERDANT_HILLS_SHEEP_CEILING);
        }
        expect(layoutVerdantHillsFieldTrees(null, 0)).toEqual([]);
        expect(layoutVerdantHillsFarTrees(null, -5)).toEqual([]);
        expect(layoutVerdantHillsSheep(null, 7.9)).toHaveLength(7);
        expect(layoutVerdantHillsFarTrees(null, 5000)).toHaveLength(VERDANT_HILLS_FAR_TREE_CEILING);
        expect(layoutVerdantHillsFieldTrees(null, Number.NaN)).toHaveLength(VERDANT_HILLS_FIELD_TREE_CEILING);
        // The same holds for a generator of one's own: a shorter list is the start of the longer.
        const twelve = layoutVerdantHillsFieldTrees(seededRandom(99), 12);
        expect(twelve).toHaveLength(12);
        expect(layoutVerdantHillsFieldTrees(seededRandom(99), 30).slice(0, 12)).toEqual(twelve);
        expect(twelve).not.toEqual(field.slice(0, 12));
    }, SLOW);

    it('measures bearings from -Z, positive to the right, and ranges and slopes over the ground', () => {
        expect(verdantHillsBearing(0, -10)).toBeCloseTo(0, 9);
        expect(verdantHillsBearing(10, -10)).toBeCloseTo(45, 9);
        expect(verdantHillsBearing(-10, -10)).toBeCloseTo(-45, 9);
        expect(verdantHillsRange(3, -4)).toBeCloseTo(5, 9);
        // The terraces are level; the face of the home hill straight ahead is steep.
        for (const { x, z } of VERDANT_HILLS_TERRACES) expect(verdantHillsSlope(x, z, 0.4)).toBeLessThan(1);
        expect(verdantHillsSlope(0, -60)).toBeGreaterThan(12);
        expect(MILL_BEARING).toBeCloseTo(28, 0);
        expect(MILL_RANGE).toBeCloseTo(251, 0);
    });
});

describe('Verdant Hills layout: the trees placed by hand', () => {
    const [hero, ...others] = VERDANT_HILLS_FEATURE_TREES;

    it('stands the old oak on its terrace, its long bough turned a little toward the lens', () => {
        expect(hero).toMatchObject({
            asset: 'oak-hero', x: oak.x, z: oak.z, scale: 1,
        });
        expect(hero.far).toBeFalsy();
        // Left of the board, close enough that its crown hangs over the top of the frame.
        expect(bearing(hero)).toBeLessThan(-25);
        expect(range(hero)).toBeLessThan(20);
        expect(VERDANT_HILLS_TERRACES.some((terrace) => terrace.x === hero.x && terrace.z === hero.z)).toBe(true);
        // The bough is the tree's own +X: it still reaches right, across the frame, and
        // about twenty degrees toward the lens, so that it climbs out of the top of the frame.
        expect(hero.yaw).toBeCloseTo(-0.35, 9);
        const bough = { x: Math.cos(hero.yaw), z: -Math.sin(hero.yaw) };
        expect(bough.x).toBeGreaterThan(0.9);
        expect(Math.atan2(bough.z, bough.x) * (180 / Math.PI)).toBeGreaterThan(15);
        expect(Math.atan2(bough.z, bough.x) * (180 / Math.PI)).toBeLessThan(25);
    });

    it('places a gate oak, two by the mill, two on the left spur and one on the nose of the right', () => {
        expect(others).toHaveLength(6);
        const near = (x, z) => others.filter((tree) => Math.hypot(tree.x - x, tree.z - z) < 12);
        expect(near(30, -36)).toHaveLength(1);
        expect(near(151, -238)).toHaveLength(1);
        expect(near(95, -250)).toHaveLength(1);
        expect(near(-80, -96)).toHaveLength(1);
        expect(near(-97, -113)).toHaveLength(1);
        expect(near(66, -100)).toHaveLength(1);
        for (const tree of others) {
            expect(VERDANT_HILLS_TREE_SHAPES[tree.asset], tree.asset).toBeDefined();
            expect(tree.asset).toMatch(/^oak-field-[abc]$/);
            expect(tree.scale).toBeGreaterThan(0.8);
            expect(tree.scale).toBeLessThan(1.25);
            expect(tree.tone).toBeGreaterThanOrEqual(0);
            expect(tree.tone).toBeLessThanOrEqual(1);
            // Anything past the gate is a tree of the middle distance.
            expect(Boolean(tree.far), at(tree)).toBe(range(tree) > VERDANT_HILLS_SHADOW_REACH);
        }
    });

    it('roots every one on dry, gentle ground the lens can see, inside the widest frame', () => {
        for (const tree of VERDANT_HILLS_FEATURE_TREES) {
            const y = ground(tree);
            const height = heightOf(tree);
            expect(verdantHillsWaterDistance(tree.x, tree.z), at(tree)).toBeGreaterThan(100);
            expect(verdantHillsSlope(tree.x, tree.z), at(tree)).toBeLessThanOrEqual(20);
            expect(visible(tree.x, y + height * 0.5, tree.z, height * 0.5), at(tree)).toBe(true);
            // Its bole and its crown, whatever the brow hides of its foot.
            expect(verdantHillsInSight(tree.x, y + 2.5, tree.z), at(tree)).toBe(true);
            expect(verdantHillsInSight(tree.x, y + height * 0.6, tree.z), at(tree)).toBe(true);
        }
    });

    it('keeps every trunk clear of the windmill, of the old oak, of the path and of the wall', () => {
        const oakBearing = bearing(hero);
        for (const tree of others) {
            // Six degrees either side of the mill, however far the tree stands.
            expect(Math.abs(bearing(tree) - MILL_BEARING), at(tree)).toBeGreaterThanOrEqual(6);
            // Nothing stands between the lens and the old oak.
            const inFront = Math.abs(bearing(tree) - oakBearing) < 12 && range(tree) < range(hero) + 12;
            expect(inFront, at(tree)).toBe(false);
            expect(verdantHillsPathDistance(tree.x, tree.z), at(tree)).toBeGreaterThan(1.2);
            expect(verdantHillsWallDistance(tree.x, tree.z), at(tree)).toBeGreaterThan(1.5);
            expect(Math.hypot(tree.x - mill.x, tree.z - mill.z), at(tree)).toBeGreaterThan(20);
        }
        expect(closest(VERDANT_HILLS_FEATURE_TREES)).toBeGreaterThan(14);
    });
});

describe('Verdant Hills layout: the oaks of the middle distance', () => {
    const field = layoutVerdantHillsFieldTrees();

    it('plants forty between 160 and 620 metres, each in the wedge and in sight', () => {
        expect(field).toHaveLength(40);
        for (const tree of field) {
            const y = ground(tree);
            expect(range(tree), at(tree)).toBeGreaterThanOrEqual(160);
            expect(range(tree), at(tree)).toBeLessThanOrEqual(620);
            expect(visible(tree.x, y + 6, tree.z, 6), at(tree)).toBe(true);
            // The lower crown shows, not only the tip: a modelled tree earns its triangles.
            expect(verdantHillsInSight(tree.x, y + 4.5, tree.z), at(tree)).toBe(true);
            expect(verdantHillsSlope(tree.x, tree.z), at(tree)).toBeLessThanOrEqual(20);
            expect(tree.far).toBe(true);
        }
    });

    it('keeps them out of the water, apart from one another and clear of the windmill', () => {
        for (const tree of field) {
            expect(verdantHillsWaterDistance(tree.x, tree.z), at(tree)).toBeGreaterThanOrEqual(14);
            // None stands in front of the mill; one behind it keeps off its sails.
            const off = Math.abs(bearing(tree) - MILL_BEARING);
            if (range(tree) < MILL_RANGE) expect(off, at(tree)).toBeGreaterThanOrEqual(6);
            else if (range(tree) < MILL_RANGE + 150) expect(off, at(tree)).toBeGreaterThanOrEqual(3.6);
            expect(Math.hypot(tree.x - mill.x, tree.z - mill.z), at(tree)).toBeGreaterThan(34);
        }
        expect(closest(field)).toBeGreaterThanOrEqual(16);
        expect(closest(field, VERDANT_HILLS_FEATURE_TREES)).toBeGreaterThanOrEqual(16);
    });

    it('stands them in hedgerows as far as the lens sees hedge this close, and alone in pastures', () => {
        const hedgerow = field.filter((tree) => tree.hedgerow);
        const alone = field.filter((tree) => !tree.hedgerow);
        for (const tree of hedgerow) expect(verdantHillsFieldAt(tree.x, tree.z).hedge, at(tree)).toBeGreaterThan(0.5);
        for (const tree of alone) {
            const land = verdantHillsFieldAt(tree.x, tree.z);
            expect(land.hedge, at(tree)).toBeLessThan(0.02);
            // Well inside its field, not on a boundary that happens to carry no hedge.
            expect(land.edge, at(tree)).toBeGreaterThan(16);
        }
        // The visible hedge within 620 metres holds about a dozen and a half at this spacing.
        expect(hedgerow.length).toBeGreaterThanOrEqual(12);
        expect(alone.length).toBeGreaterThanOrEqual(13);
        // The hedgerow trees come early: a cheap tier keeps them.
        expect(field.slice(0, 20).filter((tree) => tree.hedgerow).length).toBeGreaterThanOrEqual(10);
    });

    it('puts the first of the list where a 16:9 frame shows them beside the board, on both sides', () => {
        const beside = (tree) => Math.abs(bearing(tree)) >= 10.5 && Math.abs(bearing(tree)) <= 36;
        const first = field.slice(0, VERDANT_HILLS_TIERS.Low.fieldTrees);
        expect(first.filter(beside).length).toBeGreaterThanOrEqual(8);
        expect(first.filter((tree) => beside(tree) && bearing(tree) > 0).length).toBeGreaterThanOrEqual(1);
        expect(first.filter((tree) => beside(tree) && bearing(tree) < 0).length).toBeGreaterThanOrEqual(2);
    });

    it('describes each as the modelled tree it is and as the sprite that can stand in for it', () => {
        const assets = new Set();
        for (const tree of field) {
            const shape = VERDANT_HILLS_TREE_SHAPES[tree.asset];
            assets.add(tree.asset);
            expect(tree.asset).toMatch(/^oak-field-[abc]$/);
            expect(tree.scale).toBeGreaterThanOrEqual(0.86);
            expect(tree.scale).toBeLessThanOrEqual(1.22);
            expect(tree.cell).toBe(shape.cell);
            expect(VERDANT_HILLS_SPRITE_CELLS[tree.cell]).toBe(tree.asset);
            expect(tree.height).toBeCloseTo(shape.height * tree.scale, 9);
            expect(tree.spread).toBeCloseTo(shape.spread * tree.scale, 9);
            expect(tree.tone).toBeGreaterThanOrEqual(0);
            expect(tree.tone).toBeLessThanOrEqual(1);
            expect(Number.isFinite(tree.yaw)).toBe(true);
        }
        expect(assets.size).toBe(3);
        // The squat, wind-shaped oak leans the way the wind blows: its own +X turned downwind.
        for (const tree of field.filter((entry) => entry.asset === 'oak-field-b')) {
            const lean = { x: Math.cos(tree.yaw), z: -Math.sin(tree.yaw) };
            const downwind = lean.x * VERDANT_HILLS_WIND_DIRECTION.x + lean.z * VERDANT_HILLS_WIND_DIRECTION.z;
            expect(downwind, at(tree)).toBeGreaterThan(0.9);
        }
    });

    it('plants as soundly from any other generator', () => {
        const other = layoutVerdantHillsFieldTrees(seededRandom(20261009));
        expect(other.length).toBeGreaterThanOrEqual(36);
        expect(closest(other)).toBeGreaterThanOrEqual(16);
        for (const tree of other) {
            expect(verdantHillsWaterDistance(tree.x, tree.z), at(tree)).toBeGreaterThanOrEqual(14);
            expect(verdantHillsInSight(tree.x, ground(tree) + 4.5, tree.z), at(tree)).toBe(true);
        }
    }, SLOW);
});

describe('Verdant Hills layout: the trees of the far hills', () => {
    const far = layoutVerdantHillsFarTrees();

    it('plants nine hundred from 200 metres to 5.2 kilometres, nearest first', () => {
        expect(far).toHaveLength(900);
        const ranges = far.map(range);
        expect(ranges[0]).toBeGreaterThanOrEqual(200);
        expect(ranges[ranges.length - 1]).toBeLessThanOrEqual(5200);
        for (let index = 1; index < ranges.length; index++) {
            expect(ranges[index], `tree ${index}`).toBeGreaterThanOrEqual(ranges[index - 1]);
        }
        // So the cheapest tier keeps the near valley whole, and the dearer ones reach the far ridges.
        expect(ranges[VERDANT_HILLS_TIERS.Minimal.farTrees - 1]).toBeGreaterThan(800);
        expect(ranges[VERDANT_HILLS_TIERS.Extreme.farTrees - 1]).toBeGreaterThan(4500);
    });

    it('stands every one on dry land inside the widest frame, its top in sight', () => {
        for (const tree of far) {
            const y = ground(tree);
            expect(verdantHillsFieldAt(tree.x, tree.z).water, at(tree)).toBe(0);
            expect(verdantHillsWaterDistance(tree.x, tree.z), at(tree)).toBeGreaterThan(4);
            expect(visible(tree.x, y + 5, tree.z, 10), at(tree)).toBe(true);
            expect(Math.abs(bearing(tree)), at(tree)).toBeLessThan(57);
            // A tree the land hides altogether is not planted.
            expect(verdantHillsInSight(tree.x, y + tree.height, tree.z), at(tree)).toBe(true);
        }
    });

    it('spaces them twelve metres or more, and as far from the modelled trees', () => {
        expect(closest(far)).toBeGreaterThanOrEqual(12);
        expect(closest(far, layoutVerdantHillsFieldTrees())).toBeGreaterThanOrEqual(12);
        expect(closest(far, VERDANT_HILLS_FEATURE_TREES)).toBeGreaterThanOrEqual(12);
        // None stands in front of the windmill, or close enough behind it to tangle with its sails.
        for (const tree of far) {
            const off = Math.abs(bearing(tree) - MILL_BEARING);
            if (range(tree) < MILL_RANGE) expect(off, at(tree)).toBeGreaterThanOrEqual(6);
            else if (range(tree) < MILL_RANGE + 150) expect(off, at(tree)).toBeGreaterThanOrEqual(3.6);
        }
    });

    it('gives each a height, a spread, a sprite and a tone', () => {
        const cells = [0, 0, 0, 0];
        for (const tree of far) {
            const shape = VERDANT_HILLS_TREE_SHAPES[VERDANT_HILLS_SPRITE_CELLS[tree.cell]];
            cells[tree.cell] += 1;
            expect(tree.height).toBeGreaterThanOrEqual(9);
            expect(tree.height).toBeLessThanOrEqual(15);
            // As wide for its height as the tree its sprite was rendered from.
            expect(tree.spread / tree.height).toBeCloseTo(shape.spread / shape.height, 9);
            expect(tree.tone).toBeGreaterThanOrEqual(0);
            expect(tree.tone).toBeLessThanOrEqual(1);
            expect(tree.phase).toBeGreaterThanOrEqual(0);
            expect(tree.phase).toBeLessThan(1);
            expect(typeof tree.flip).toBe('boolean');
        }
        // The three field trees in like numbers; the old oak's sprite only for a few lone oaks.
        cells.slice(0, 3).forEach((count) => expect(count).toBeGreaterThan(220));
        expect(cells[3]).toBeGreaterThan(10);
        expect(cells[3]).toBeLessThan(80);
        expect(far.filter((tree) => tree.flip).length).toBeGreaterThan(350);
        expect(far.filter((tree) => tree.flip).length).toBeLessThan(550);
    });

    it('plants most along the hedgerows, a dozen copses on the crests and a few alone', () => {
        const kinds = { hedgerow: [], copse: [], alone: [] };
        far.forEach((tree) => kinds[tree.kind].push(tree));
        expect(kinds.hedgerow.length).toBeGreaterThan(560);
        expect(kinds.copse.length).toBeGreaterThan(120);
        expect(kinds.alone.length).toBeGreaterThan(50);
        expect(kinds.alone.length).toBeLessThan(160);
        for (const tree of kinds.hedgerow) {
            expect(verdantHillsFieldAt(tree.x, tree.z).hedge, at(tree)).toBeGreaterThan(0.5);
        }
        for (const tree of kinds.alone) {
            const land = verdantHillsFieldAt(tree.x, tree.z);
            expect(land.hedge, at(tree)).toBeLessThan(0.02);
            expect(land.edge, at(tree)).toBeGreaterThan(22);
        }
        // Only a lone tree is an old spreading oak.
        expect(far.filter((tree) => tree.cell === 3).every((tree) => tree.kind === 'alone')).toBe(true);
        // Gather the copse trees into their copses: a copse is under 80 metres across, and
        // the next one stands a couple of hundred metres off.
        const copses = [];
        kinds.copse.forEach((tree) => {
            const home = copses.find((copse) => apart(copse[0], tree) < 100);
            if (home) home.push(tree);
            else copses.push([tree]);
        });
        expect(copses.length).toBeGreaterThanOrEqual(10);
        expect(copses.length).toBeLessThanOrEqual(14);
        for (const copse of copses) {
            const x = copse.reduce((total, tree) => total + tree.x, 0) / copse.length;
            const z = copse.reduce((total, tree) => total + tree.z, 0) / copse.length;
            // A crest: it stands above the mean of the land 70 metres away on four sides.
            const around = (verdantHillsGroundHeight(x + 70, z) + verdantHillsGroundHeight(x - 70, z)
                + verdantHillsGroundHeight(x, z + 70) + verdantHillsGroundHeight(x, z - 70)) / 4;
            expect(verdantHillsGroundHeight(x, z) - around, `copse at ${at({ x, z })}`).toBeGreaterThan(1.5);
            expect(copse.length).toBeGreaterThanOrEqual(8);
            copse.forEach((tree) => expect(Math.hypot(tree.x - x, tree.z - z)).toBeLessThan(48));
        }
    });

    it('plants as soundly from any other generator, still clear of the field trees', () => {
        const other = layoutVerdantHillsFarTrees(seededRandom(77));
        expect(other).toHaveLength(900);
        expect(other).not.toEqual(far);
        expect(closest(other)).toBeGreaterThanOrEqual(12);
        expect(closest(other, layoutVerdantHillsFieldTrees())).toBeGreaterThanOrEqual(12);
        expect(other.every((tree, index) => index === 0 || range(tree) >= range(other[index - 1]))).toBe(true);
    }, SLOW);
});

describe('Verdant Hills layout: the shade baked into the land', () => {
    const shadows = verdantHillsTreeShadows();

    it('lists every tree beyond the shadow map out to the shade horizon, and the windmill', () => {
        const features = VERDANT_HILLS_FEATURE_TREES.filter((tree) => range(tree) > VERDANT_HILLS_SHADOW_REACH);
        const field = layoutVerdantHillsFieldTrees();
        const far = layoutVerdantHillsFarTrees().filter((tree) => range(tree) <= VERDANT_HILLS_SHADE_HORIZON);
        // The old oak and the gate oak are in the shadow map; everything else is here.
        expect(features).toHaveLength(VERDANT_HILLS_FEATURE_TREES.length - 2);
        expect(far.length).toBeGreaterThan(450);
        expect(shadows).toHaveLength(features.length + field.length + far.length + VERDANT_HILLS_BUILT_SHADOWS.length);
        const has = (place) => shadows.some((shadow) => shadow.x === place.x && shadow.z === place.z);
        [...features, ...field, ...far, ...VERDANT_HILLS_BUILT_SHADOWS]
            .forEach((tree) => expect(has(tree), at(tree)).toBe(true));
        expect(has(oak)).toBe(false);
        expect(has(mill)).toBe(true);
    });

    it('is a plain list the land map can be made from, the same whichever tier asks', () => {
        for (const shadow of shadows) {
            expect(Object.keys(shadow).sort()).toEqual(['height', 'spread', 'x', 'z']);
            expect(Object.values(shadow).every(Number.isFinite)).toBe(true);
            expect(shadow.height).toBeGreaterThanOrEqual(8);
            expect(shadow.height).toBeLessThanOrEqual(18);
            expect(shadow.spread).toBeGreaterThan(5);
            expect(shadow.spread).toBeLessThan(21);
        }
        expect(verdantHillsTreeShadows()).toEqual(shadows);
        // A modelled tree's shadow is its crown at its own scale.
        const tree = layoutVerdantHillsFieldTrees()[0];
        expect(shadows.find((shadow) => shadow.x === tree.x && shadow.z === tree.z)).toEqual({
            x: tree.x, z: tree.z, height: tree.height, spread: tree.spread,
        });
        // The windmill may be left out, and other lists handed in.
        const [tower] = VERDANT_HILLS_BUILT_SHADOWS;
        expect(verdantHillsTreeShadows({ built: [] }))
            .toHaveLength(shadows.length - VERDANT_HILLS_BUILT_SHADOWS.length);
        expect(verdantHillsTreeShadows({ features: [], field: [], far: [] })).toEqual([{
            x: mill.x, z: mill.z, height: tower.height, spread: tower.spread,
        }]);
    });
});

describe('Verdant Hills layout: the windmill, the gate, the bench, the outcrops and the posts', () => {
    it('turns the windmill into the wind on its terrace', () => {
        expect(VERDANT_HILLS_MILL).toMatchObject({ x: mill.x, z: mill.z });
        const front = facing(VERDANT_HILLS_MILL.yaw);
        // Its sails face the way the wind comes from, which is also very nearly toward the lens.
        const intoWind = -(front.x * VERDANT_HILLS_WIND_DIRECTION.x + front.z * VERDANT_HILLS_WIND_DIRECTION.z);
        expect(intoWind).toBeGreaterThan(0.999);
        const toLens = (front.x * -mill.x + front.z * -mill.z) / MILL_RANGE;
        expect(toLens).toBeGreaterThan(0.99);
        expect(VERDANT_HILLS_MILL.bed).toBeCloseTo(0.15, 9);
        const terrace = VERDANT_HILLS_TERRACES.find((entry) => entry.x === mill.x && entry.z === mill.z);
        expect(terrace.radius).toBeGreaterThan(4);
    });

    it('hangs the gate across the path, on its terrace', () => {
        expect(VERDANT_HILLS_GATE).toMatchObject({ x: gate.x, z: gate.z });
        expect(verdantHillsPathDistance(gate.x, gate.z)).toBeLessThan(0.01);
        // The gate lies along its own X: its two posts stand either side of the path, level.
        const left = alongGate(-GATE_POST);
        const right = alongGate(GATE_POST);
        expect(verdantHillsPathDistance(left.x, left.z)).toBeCloseTo(GATE_POST, 1);
        expect(verdantHillsPathDistance(right.x, right.z)).toBeCloseTo(GATE_POST, 1);
        expect(Math.abs(ground(left) - ground(gate))).toBeLessThan(0.02);
        expect(Math.abs(ground(right) - ground(gate))).toBeLessThan(0.02);
        // +X is the right of the path as one walks away from the lens, so further from the centre line.
        expect(bearing(right)).toBeGreaterThan(bearing(left));
        // Its front is up the path, toward the lens.
        const front = facing(VERDANT_HILLS_GATE.yaw);
        expect((front.x * -gate.x + front.z * -gate.z) / range(gate)).toBeGreaterThan(0.95);
        expect(VERDANT_HILLS_GATE.bed).toBeGreaterThan(0);
        expect(VERDANT_HILLS_GATE.bed).toBeLessThan(0.1);
    });

    it('faces the bench out over the valley, turned a little toward the oak\'s open side', () => {
        expect(VERDANT_HILLS_BENCH).toMatchObject({ x: bench.x, z: bench.z });
        const front = facing(VERDANT_HILLS_BENCH.yaw);
        expect(front.z).toBeLessThan(-0.9);
        // The long bough reaches +X: the open side under it is to the right.
        expect(front.x).toBeGreaterThan(0.1);
        expect(front.x).toBeLessThan(0.45);
        expect(verdantHillsSlope(bench.x, bench.z, 0.4)).toBeLessThan(2);
    });

    it('beds three or four outcrops under the oak and beside the path, in sight and out of the way', () => {
        expect(VERDANT_HILLS_BOULDERS.length).toBeGreaterThanOrEqual(3);
        expect(VERDANT_HILLS_BOULDERS.length).toBeLessThanOrEqual(4);
        let byTheOak = 0;
        let byThePath = 0;
        // The old wall on the left spur is seen between the bench and the swing: nothing hides it.
        const oldWall = Math.max(...VERDANT_HILLS_WALL.find((entry) => entry.name === 'left').points
            .map(([x, z]) => verdantHillsBearing(x, z)));
        for (const stone of VERDANT_HILLS_BOULDERS) {
            expect(stone.asset).toMatch(/^boulder_[abc]$/);
            expect(verdantHillsInSight(stone.x, ground(stone) + 0.3, stone.z), at(stone)).toBe(true);
            expect(visible(stone.x, ground(stone) + 0.3, stone.z, 1), at(stone)).toBe(true);
            // Inside a 16:9 frame, and clear of the board card's middle.
            expect(Math.abs(bearing(stone)), at(stone)).toBeLessThan(36);
            expect(Math.abs(bearing(stone)), at(stone)).toBeGreaterThan(10);
            expect(stone.bed).toBeGreaterThan(0.03);
            expect(stone.bed).toBeLessThan(0.2);
            // Off the trodden line, off the bench, and not inside the trunk or the wall.
            expect(verdantHillsPathDistance(stone.x, stone.z), at(stone)).toBeGreaterThan(1.2);
            expect(Math.hypot(stone.x - bench.x, stone.z - bench.z), at(stone)).toBeGreaterThan(2.5);
            expect(Math.hypot(stone.x - oak.x, stone.z - oak.z), at(stone)).toBeGreaterThan(2.4);
            expect(verdantHillsWallDistance(stone.x, stone.z), at(stone)).toBeGreaterThan(2);
            // Under the oak's crown, on the valley side and right of the trunk as the lens sees it.
            if (Math.hypot(stone.x - oak.x, stone.z - oak.z) < 7.5) {
                byTheOak += 1;
                expect(stone.z, at(stone)).toBeLessThan(oak.z);
                expect(bearing(stone) - verdantHillsBearing(oak.x, oak.z), at(stone)).toBeGreaterThan(12);
                // Its near edge keeps to the right of where the old wall runs down the spur.
                const halfWidth = Math.atan2(1.2 * stone.scale, range(stone)) * (180 / Math.PI);
                expect(bearing(stone) - halfWidth, at(stone)).toBeGreaterThan(oldWall);
            }
            if (verdantHillsPathDistance(stone.x, stone.z) < 4) byThePath += 1;
        }
        expect(byTheOak).toBeGreaterThanOrEqual(1);
        expect(byThePath).toBeGreaterThanOrEqual(1);
        expect(closest(VERDANT_HILLS_BOULDERS)).toBeGreaterThan(1.5);
        // Those beside the path lie on its left, toward the middle of the frame: the path is
        // between them and the wall that keeps to its right.
        const spur = [VERDANT_HILLS_WALL.find((entry) => entry.name === 'spur')];
        for (const stone of VERDANT_HILLS_BOULDERS.filter((entry) => verdantHillsPathDistance(entry.x, entry.z) < 4)) {
            expect(verdantHillsWallDistance(stone.x, stone.z, spur), at(stone))
                .toBeGreaterThan(verdantHillsPathDistance(stone.x, stone.z) + 2);
        }
    });

    it('stands a post at every kite station', () => {
        expect(VERDANT_HILLS_POSTS).toHaveLength(VERDANT_HILLS_KITE_STATIONS.length);
        VERDANT_HILLS_POSTS.forEach((post, slot) => {
            const [x, z] = VERDANT_HILLS_KITE_STATIONS[slot].post;
            expect(post).toMatchObject({ x, z, height: VERDANT_HILLS_POST_HEIGHT });
            expect(Number.isFinite(post.yaw)).toBe(true);
            expect(verdantHillsWallDistance(x, z), `post ${slot}`).toBeGreaterThan(1);
        });
    });
});

describe('Verdant Hills layout: the drystone wall', () => {
    const sections = layoutVerdantHillsWall();
    const heads = layoutVerdantHillsWallHeads();
    const run = (name) => sections.filter((section) => section.run === name);

    it('runs down the right-hand spur beside the path, from about 12 to about 110 metres out', () => {
        const spur = VERDANT_HILLS_WALL.find((entry) => entry.name === 'spur');
        expect(spur.points.length).toBeGreaterThan(4);
        const first = spur.points[0];
        const last = spur.points[spur.points.length - 1];
        expect(verdantHillsRange(...first)).toBeGreaterThan(11);
        expect(verdantHillsRange(...first)).toBeLessThan(14);
        expect(verdantHillsRange(...last)).toBeGreaterThan(105);
        expect(verdantHillsRange(...last)).toBeLessThan(112);
        // Always to the right of the path as one walks down it, so further from the centre line.
        const length = VERDANT_HILLS_PATH.slice(1).reduce((total, [x, z], index) => (
            total + Math.hypot(x - VERDANT_HILLS_PATH[index][0], z - VERDANT_HILLS_PATH[index][1])), 0);
        for (let along = 12; along < length - 8; along += 2) {
            const [px, pz] = verdantHillsBesidePath(along);
            const [rx, rz] = verdantHillsBesidePath(along, 3);
            expect(verdantHillsBearing(rx, rz), `${along} m down the path`)
                .toBeGreaterThan(verdantHillsBearing(px, pz));
            // The wall is nearer the right-hand point than the path is: it lies on that side.
            expect(verdantHillsWallDistance(rx, rz, [spur]), `${along} m down the path`)
                .toBeLessThan(verdantHillsWallDistance(px, pz, [spur]));
        }
        for (const section of run('spur')) {
            const off = verdantHillsPathDistance(section.x, section.z);
            // Four metres off, drawing in to the gate's post as it passes.
            expect(off, at(section)).toBeGreaterThan(2.3);
            expect(off, at(section)).toBeLessThan(6);
        }
    });

    it('breaks only at the gate: the spur wall passes one post, the cross wall leaves the other', () => {
        expect(VERDANT_HILLS_WALL.map((entry) => entry.name)).toEqual(['spur', 'cross', 'left']);
        const right = alongGate(GATE_POST);
        const spur = [VERDANT_HILLS_WALL[0]];
        const cross = VERDANT_HILLS_WALL[1];
        // The spur wall's face meets the right-hand post.
        expect(verdantHillsWallDistance(right.x, right.z, spur)).toBeLessThan(WALL_HALF + GATE_POST_SIZE / 2 + 0.02);
        expect(verdantHillsWallDistance(right.x, right.z, spur)).toBeGreaterThan(0.3);
        // The cross wall stops a pier short of the left-hand post, so that the pier which
        // finishes it stands against the post, and runs on along the gate's own line.
        const [start, end] = cross.points;
        const face = alongGate(-(GATE_POST + GATE_POST_SIZE / 2));
        expect(Math.hypot(start[0] - face.x, start[1] - face.z)).toBeCloseTo(PIER_REACH, 2);
        expect(Math.hypot(start[0] - gate.x, start[1] - gate.z))
            .toBeCloseTo(GATE_POST + GATE_POST_SIZE / 2 + PIER_REACH, 2);
        const reach = alongGate(-(GATE_POST + 10));
        expect(verdantHillsWallDistance(reach.x, reach.z, [cross])).toBeLessThan(0.05);
        expect(verdantHillsBearing(...end)).toBeLessThan(verdantHillsBearing(...start) - 12);
        expect(cross.heads).toEqual([true, true]);
        // Nothing but the gate stands in the gateway, and no wall crosses the path anywhere.
        expect(verdantHillsWallDistance(gate.x, gate.z)).toBeGreaterThan(GATE_POST);
        for (const section of sections) {
            expect(verdantHillsPathDistance(section.from.x, section.from.z), at(section)).toBeGreaterThan(1.7);
            expect(verdantHillsPathDistance(section.to.x, section.to.z), at(section)).toBeGreaterThan(1.7);
        }
    });

    it('lays every section on the ground at both ends, and each run end to end', () => {
        expect(sections.length).toBeGreaterThan(30);
        for (const section of sections) {
            // Both ends within 6 cm of the ground: bedded, never floating.
            for (const foot of [section.from, section.to]) {
                const height = verdantHillsGroundHeight(foot.x, foot.z);
                expect(foot.y, at(section)).toBeLessThanOrEqual(height);
                expect(height - foot.y, at(section)).toBeLessThan(0.06);
            }
            // Its middle is half way between its feet; `yaw` turns the model's +X along it,
            // `pitch` is the slope of its base and `stretch` its length over the model's own.
            const reach = new THREE.Vector3(section.to.x - section.from.x, section.to.y - section.from.y, section.to.z
                - section.from.z);
            expect(section.x).toBeCloseTo((section.from.x + section.to.x) / 2, 9);
            expect(section.y).toBeCloseTo((section.from.y + section.to.y) / 2, 9);
            expect(section.z).toBeCloseTo((section.from.z + section.to.z) / 2, 9);
            const heading = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), section.yaw);
            expect(heading.dot(new THREE.Vector3(reach.x, 0, reach.z).normalize()), at(section)).toBeCloseTo(1, 9);
            expect(Math.tan(section.pitch)).toBeCloseTo(reach.y / Math.hypot(reach.x, reach.z), 9);
            expect(section.stretch).toBeCloseTo(reach.length() / VERDANT_HILLS_WALL_SECTION, 9);
            // A section is the four-metre model, a little longer or shorter, never a sliver.
            expect(section.stretch, at(section)).toBeGreaterThan(0.55);
            expect(section.stretch, at(section)).toBeLessThan(1.2);
            expect(Math.abs(section.pitch), at(section)).toBeLessThan(0.5);
            // Between its ends its base neither hangs over a hollow nor is swallowed by a bulge.
            for (const t of [0.25, 0.5, 0.75]) {
                const x = section.from.x + (section.to.x - section.from.x) * t;
                const z = section.from.z + (section.to.z - section.from.z) * t;
                const base = section.from.y + (section.to.y - section.from.y) * t;
                expect(base - verdantHillsGroundHeight(x, z), at(section)).toBeLessThan(0.2);
                expect(verdantHillsGroundHeight(x, z) - base, at(section)).toBeLessThan(0.45);
            }
        }
        for (const entry of VERDANT_HILLS_WALL) {
            const own = run(entry.name);
            expect(own.length, entry.name).toBeGreaterThan(2);
            for (let index = 1; index < own.length; index++) {
                expect(apart(own[index].from, own[index - 1].to), `${entry.name} ${index}`).toBeLessThan(1e-9);
                expect(own[index].from.y).toBeCloseTo(own[index - 1].to.y, 9);
            }
            // From the run's first point to its last.
            const [x0, z0] = entry.points[0];
            const [x1, z1] = entry.points[entry.points.length - 1];
            expect(Math.hypot(own[0].from.x - x0, own[0].from.z - z0)).toBeLessThan(1e-9);
            expect(Math.hypot(own[own.length - 1].to.x - x1, own[own.length - 1].to.z - z1)).toBeLessThan(1e-9);
        }
        // The cross wall steps down the fall of the hill; the spur wall runs nearly level below the gate.
        expect(Math.min(...run('cross').map((section) => section.pitch))).toBeLessThan(-0.3);
    });

    it('brings a second, short run down the left spur, out of the old oak\'s bearing', () => {
        const left = run('left');
        const oakBearing = verdantHillsBearing(oak.x, oak.z);
        expect(verdantHillsRange(left[0].from.x, left[0].from.z)).toBeGreaterThan(28);
        expect(verdantHillsRange(left[left.length - 1].to.x, left[left.length - 1].to.z)).toBeLessThan(78);
        for (const section of left) {
            // To the right of the trunk as the lens sees it, and inside a 16:9 frame.
            expect(bearing(section) - oakBearing, at(section)).toBeGreaterThan(5);
            expect(Math.abs(bearing(section)), at(section)).toBeLessThan(36);
            expect(verdantHillsInSight(section.x, section.y + 1.15, section.z), at(section)).toBe(true);
        }
        // It stays clear of every kite post and of the bench.
        VERDANT_HILLS_POSTS.forEach((post) => expect(verdantHillsWallDistance(post.x, post.z)).toBeGreaterThan(1));
        expect(verdantHillsWallDistance(bench.x, bench.z)).toBeGreaterThan(8);
    });

    it('finishes every end of every run with a pier that faces away from its run', () => {
        // No run ends in a cut section: two ends each, six piers.
        expect(VERDANT_HILLS_WALL.every((entry) => entry.heads[0] && entry.heads[1])).toBe(true);
        expect(heads).toHaveLength(6);
        expect(heads.map((head) => head.run)).toEqual(['spur', 'spur', 'cross', 'cross', 'left', 'left']);
        for (const head of heads) {
            expect(verdantHillsGroundHeight(head.x, head.z) - head.y).toBeGreaterThanOrEqual(0);
            expect(verdantHillsGroundHeight(head.x, head.z) - head.y).toBeLessThan(0.06);
            // On the end of its run; a step along its own +X leaves the wall behind.
            expect(verdantHillsWallDistance(head.x, head.z)).toBeLessThan(1e-9);
            const out = { x: head.x + Math.cos(head.yaw) * 0.5, z: head.z - Math.sin(head.yaw) * 0.5 };
            expect(verdantHillsWallDistance(out.x, out.z), `${head.run} head`).toBeGreaterThan(0.49);
        }
        // One pier stands at the gate: the cross wall's, its far face against the left-hand post.
        const atGate = heads.filter((head) => Math.hypot(head.x - gate.x, head.z - gate.z) < 8);
        expect(atGate).toHaveLength(1);
        const [pier] = atGate;
        expect(pier.run).toBe('cross');
        const tip = { x: pier.x + Math.cos(pier.yaw) * PIER_REACH, z: pier.z - Math.sin(pier.yaw) * PIER_REACH };
        const post = alongGate(-GATE_POST);
        expect(Math.hypot(tip.x - post.x, tip.z - post.z)).toBeCloseTo(GATE_POST_SIZE / 2, 2);
        expect(Math.abs(ground(pier) - ground(gate))).toBeLessThan(0.1);
    });

    it('measures the distance to the nearest run', () => {
        const [x, z] = VERDANT_HILLS_WALL[2].points[1];
        expect(verdantHillsWallDistance(x, z)).toBeCloseTo(0, 9);
        expect(verdantHillsWallDistance(0, 0)).toBeGreaterThan(10);
        expect(verdantHillsWallDistance(0, 0, [])).toBe(Infinity);
    });
});

describe('Verdant Hills layout: the flock', () => {
    const flock = layoutVerdantHillsSheep();
    const groups = grouped(flock);

    it('grazes sixty sheep in loose groups of three to eight', () => {
        expect(flock).toHaveLength(60);
        expect(groups.length).toBeGreaterThanOrEqual(8);
        // The list is the groups one after another, so a tier's prefix keeps whole groups but the last.
        expect(flock.map((sheep) => sheep.group)).toEqual([...flock.map((sheep) => sheep.group)].sort((a, b) => a - b));
        groups.forEach((group, index) => {
            const last = index === groups.length - 1;
            expect(group.length).toBeGreaterThanOrEqual(last ? 1 : 3);
            expect(group.length).toBeLessThanOrEqual(8);
            const x = group.reduce((total, sheep) => total + sheep.x, 0) / group.length;
            const z = group.reduce((total, sheep) => total + sheep.z, 0) / group.length;
            group.forEach((sheep) => expect(Math.hypot(sheep.x - x, sheep.z - z)).toBeLessThan(14));
            // Loose, but nobody stands inside anybody else.
            expect(closest(group)).toBeGreaterThan(1.8);
            // They head much the same way.
            const heading = Math.atan2(
                group.reduce((total, sheep) => total + Math.sin(sheep.yaw), 0),
                group.reduce((total, sheep) => total + Math.cos(sheep.yaw), 0),
            );
            group.forEach((sheep) => {
                const off = Math.atan2(Math.sin(sheep.yaw - heading), Math.cos(sheep.yaw - heading));
                expect(Math.abs(off)).toBeLessThan(0.75);
            });
        });
        // Groups keep to themselves.
        const centres = groups.map((group) => ({
            x: group.reduce((total, sheep) => total + sheep.x, 0) / group.length,
            z: group.reduce((total, sheep) => total + sheep.z, 0) / group.length,
        }));
        expect(closest(centres)).toBeGreaterThan(30);
    });

    it('keeps every sheep on open pasture the lens can see, 230 to 900 metres out', () => {
        const trees = [...VERDANT_HILLS_FEATURE_TREES, ...layoutVerdantHillsFieldTrees(),
            ...layoutVerdantHillsFarTrees()];
        for (const sheep of flock) {
            const y = ground(sheep);
            const land = verdantHillsFieldAt(sheep.x, sheep.z);
            expect(range(sheep), at(sheep)).toBeGreaterThanOrEqual(230);
            expect(range(sheep), at(sheep)).toBeLessThanOrEqual(900);
            expect(land.hedge, at(sheep)).toBe(0);
            expect(land.water, at(sheep)).toBe(0);
            expect(verdantHillsWaterDistance(sheep.x, sheep.z), at(sheep)).toBeGreaterThan(8);
            expect(verdantHillsSlope(sheep.x, sheep.z), at(sheep)).toBeLessThan(19);
            expect(visible(sheep.x, y + 0.6, sheep.z, 1.2), at(sheep)).toBe(true);
            expect(verdantHillsInSight(sheep.x, y + 0.5, sheep.z), at(sheep)).toBe(true);
            expect(sheep.scale).toBeGreaterThan(1.1);
            expect(sheep.scale).toBeLessThan(1.45);
            expect(typeof sheep.grazing).toBe('boolean');
            expect(Math.hypot(sheep.x - mill.x, sheep.z - mill.z), at(sheep)).toBeGreaterThan(16);
        }
        // No sheep stands in a tree.
        expect(closest(flock, trees)).toBeGreaterThan(6.9);
        // Most have their heads down.
        expect(flock.filter((sheep) => sheep.grazing).length).toBeGreaterThan(30);
        expect(flock.filter((sheep) => !sheep.grazing).length).toBeGreaterThan(8);
    });

    it('puts the first group on the right of the board and the next on the left, both close by', () => {
        const first = groups[0];
        const second = groups[1];
        // The windmill's hill is what a 16:9 frame shows on the right this close.
        first.forEach((sheep) => {
            expect(bearing(sheep)).toBeGreaterThan(9);
            expect(bearing(sheep)).toBeLessThan(37);
            expect(range(sheep)).toBeLessThan(440);
        });
        second.forEach((sheep) => {
            expect(bearing(sheep)).toBeLessThan(-9);
            expect(bearing(sheep)).toBeGreaterThan(-37);
            expect(range(sheep)).toBeLessThan(440);
        });
    });

    it('plants as soundly from any other generator', () => {
        const other = layoutVerdantHillsSheep(seededRandom(5));
        expect(other.length).toBeGreaterThan(40);
        expect(other).not.toEqual(flock);
        for (const sheep of other) {
            expect(verdantHillsFieldAt(sheep.x, sheep.z).hedge, at(sheep)).toBe(0);
            expect(verdantHillsInSight(sheep.x, ground(sheep) + 0.5, sheep.z), at(sheep)).toBe(true);
        }
    }, SLOW);
});
