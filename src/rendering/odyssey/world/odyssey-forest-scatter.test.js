import { describe, expect, it } from 'vitest';

import { buildShoreDistance, scatterZonedForest } from './odyssey-forest-scatter.js';
import { FOREST_SPECIMENS } from './odyssey-forest-models-decode.js';
import {
    FOREST_BEACH, FOREST_CEILINGS, FOREST_DISC, FOREST_HEROES, FOREST_MASSIF, forestBlossomAt, forestGoldAt, siteOnNorthBeach,
} from './odyssey-forest-composition.js';
import { FOREST_ANIMAL_GROUND, FOREST_ANIMAL_REACH, FOREST_ROCKS } from './odyssey-forest-keepouts.js';
import { SEA_BEACH } from './odyssey-water-looks.js';
import { forestLodDistanceForTier } from './odyssey-forest-species.js';
import {
    ODYSSEY_SEA_LEVEL, odysseyNorthLakeDistance, odysseyTarnDistance, odysseyWorldHeight,
} from './odyssey-world-height.js';
import { buildBoulderSites } from './odyssey-boulders.js';
import { getOdysseyPathPointAt, getOdysseyWorldRailPointAt } from '../path-utils.js';

/**
 * WHERE THE TREES STAND (2026-11-24): the composition (odyssey-forest-composition.js) planted.
 */

const RAIL = Array.from({ length: 48 }, (_, i) => {
    const p = getOdysseyWorldRailPointAt(i / 47);
    return { x: p.x, y: p.y, z: p.z };
});
const FOREST = scatterZonedForest(odysseyWorldHeight, { rail: RAIL, seaLevel: ODYSSEY_SEA_LEVEL });
const T = FOREST.placements;
const at = (p) => `${p.id} at (${p.x.toFixed(0)}, ${p.z.toFixed(0)})`;
const shoreAt = buildShoreDistance(odysseyWorldHeight, ODYSSEY_SEA_LEVEL);
const trees = T.filter((p) => p.role !== 'shrub' && p.role !== 'floor');
const refuse = (p, why) => { throw new Error(`${at(p)}: ${why}`); };

describe('the ground a tree may stand on', () => {
    it('is never the sand by the sea: not a tree, not a bush, not a hero (owner, 2026-11-24)', () => {
        // The ground paints sand up to this height at the most (its lobed top, its wobble and break).
        const paintedTop = SEA_BEACH.top + SEA_BEACH.topWobble + SEA_BEACH.topBreak;
        expect(FOREST_BEACH.top).toBeGreaterThan(paintedTop);
        T.forEach((p) => {
            const over = p.y - ODYSSEY_SEA_LEVEL;
            if (over < paintedTop + 0.5 && shoreAt(p.x, p.z) < FOREST_BEACH.reach) refuse(p, `${over.toFixed(1)} u over the sea`);
        });
    });

    it('is dry: off the waters, the north beach and the sea', () => {
        T.forEach((p) => {
            if (p.y < ODYSSEY_SEA_LEVEL + 1.4) refuse(p, 'in the sea');
            if (odysseyTarnDistance(p.x, p.z) < 1.1) refuse(p, 'in the tarn');
            if (odysseyNorthLakeDistance(p.x, p.z) < 1.1) refuse(p, 'in the lake');
            if (siteOnNorthBeach(p.x, p.z)) refuse(p, 'on the north beach');
            if (Math.hypot(p.x - FOREST_DISC.cx, p.z - FOREST_DISC.cz) > FOREST_DISC.radius + 12) refuse(p, 'outside the disc');
            if (Math.abs(p.y - odysseyWorldHeight(p.x, p.z)) > 1e-6) refuse(p, 'off the ground');
        });
    });

    it('is not a cliff, and broadleaves want gentler ground than firs', () => {
        const slope = (x, z) => Math.hypot(
            (odysseyWorldHeight(x + 4, z) - odysseyWorldHeight(x - 4, z)) / 8,
            (odysseyWorldHeight(x, z + 4) - odysseyWorldHeight(x, z - 4)) / 8,
        );
        const broad = new Set(['oak', 'beech', 'birch', 'aspen', 'maple', 'cherry', 'willow']);
        T.filter((p, i) => p.role !== 'hero' && i % 5 === 0).forEach((p) => {
            const s = slope(p.x, p.z);
            if (s > (broad.has(p.speciesId) ? 0.601 : 1.281)) refuse(p, `slope ${s.toFixed(2)}`);
        });
    });

    it('is clear of the rocks and of every place the animals walk', () => {
        const rocks = buildBoulderSites(odysseyWorldHeight, { trees: [] });
        expect(rocks.length).toBe(FOREST_ROCKS.length);
        rocks.forEach((r, i) => {
            const [x, z, radius] = FOREST_ROCKS[i];
            expect(Math.hypot(r.x - x, r.z - z), 'a rock moved: update odyssey-forest-keepouts.js').toBeLessThan(0.1);
            expect(Math.max(r.sx, r.sz)).toBeLessThan(radius + 0.1);
        });
        // Every rock stands with the forest round it (a fern gives way to a rock, the renderer sees to it).
        expect(buildBoulderSites(odysseyWorldHeight, { trees: T.filter((p) => p.role !== 'floor') }).length).toBe(rocks.length);
        T.filter((p) => !p.framing).forEach((p) => {
            FOREST_ANIMAL_GROUND.forEach(([x, z]) => {
                if (Math.hypot(p.x - x, p.z - z) < FOREST_ANIMAL_REACH + (p.skirt * 0.6)) refuse(p, 'on the animals\' ground');
            });
            FOREST_CEILINGS.forEach(([x, z, r, y]) => {
                if (Math.hypot(p.x - x, p.z - z) < r && p.y + p.height > y) refuse(p, 'in the eagle\'s air');
            });
        });
    });

    it('leaves the rail its air: nothing reaches up to the eye\'s way', () => {
        for (let t = 0.15; t < 0.6; t += 0.002) {
            const q = getOdysseyPathPointAt(t);
            for (let i = 0; i < trees.length; i += 1) {
                const p = trees[i];
                const d = Math.hypot(p.x - q.x, p.z - q.z);
                if (d < p.crownR + 6 && q.y - (p.y + p.height) < 14) refuse(p, `under the rail at ${t.toFixed(3)}`);
            }
        }
    });
});

describe('the composition', () => {
    const near = (id) => T.filter((p) => p.speciesId === id);

    it('plants every kind it has', () => {
        FOREST_SPECIMENS.forEach((s, i) => expect(T.some((p) => p.specimen === i), s.id).toBe(true));
        expect(FOREST.stats.trees).toBeGreaterThan(15000);
        expect(FOREST.stats.trees).toBeLessThan(30000);
    });

    it('stands every hero where it was authored', () => {
        FOREST_HEROES.forEach((h) => {
            const found = T.some((p) => p.framing && p.id === h.id && p.x === h.x && p.z === h.z);
            expect(found, `${h.id} (${h.x}, ${h.z})`).toBe(true);
        });
    });

    it('keeps stone pines to the coast, willows to the water, cherries to their river', () => {
        near('stone-pine').forEach((p) => { if (shoreAt(p.x, p.z) > 190) refuse(p, 'inland'); });
        near('willow').forEach((p) => {
            if (Math.min(odysseyTarnDistance(p.x, p.z), odysseyNorthLakeDistance(p.x, p.z)) > 70) refuse(p, 'far from the water');
        });
        near('cherry').filter((p) => !p.framing).forEach((p) => {
            if (forestBlossomAt(p.x, p.z) < -1.65) refuse(p, 'off its river');
        });
        expect(near('cherry').length).toBeGreaterThan(150);
    });

    it('turns gold on the east side only, and never up the mountain (owner, 2026-11-17)', () => {
        [...near('aspen'), ...near('maple')].filter((p) => !p.framing).forEach((p) => {
            if (forestGoldAt(p.x, p.z) < 0.3) refuse(p, 'in the green west');
            const mountain = Math.hypot(p.x - FOREST_MASSIF.x, p.z - FOREST_MASSIF.z) < 950;
            if (mountain && p.y > 412) refuse(p, 'up the mountain');
        });
        const east = trees.filter((p) => forestGoldAt(p.x, p.z) > 0.8 && p.y < 380);
        const share = (ids) => east.filter((p) => ids.includes(p.speciesId)).length / east.length;
        expect(share(['aspen', 'maple'])).toBeGreaterThan(0.35);
        // ...with dark conifers standing in it.
        expect(share(['spruce', 'fir'])).toBeGreaterThan(0.15);
    });

    it('frays to dwarf pine and snags at the treeline, and is stunted on the way up', () => {
        const high = T.filter((p) => p.y > 470);
        expect(high.length).toBeGreaterThan(60);
        const low = new Set(['dwarf-pine', 'snag', 'juniper', 'bent-pine']);
        expect(high.filter((p) => low.has(p.speciesId)).length / high.length).toBeGreaterThan(0.35);
        const height = (list) => list.reduce((s, p) => s + p.height, 0) / list.length;
        const spruce = T.filter((p) => p.speciesId === 'spruce' && p.role === 'canopy');
        expect(height(spruce.filter((p) => p.y > 440))).toBeLessThan(height(spruce.filter((p) => p.y < 380)) * 0.85);
    });

    it('is woods and open ground, not an even scatter', () => {
        // The journey's own ground, in 40 u squares: many are closed wood, many are open grass.
        const cell = 40;
        const counts = [];
        for (let z = -520; z < -230; z += cell) {
            for (let x = -520; x < 180; x += cell) {
                const dry = odysseyWorldHeight(x + 20, z + 20) > ODYSSEY_SEA_LEVEL + 9 && odysseyTarnDistance(x + 20, z + 20) > 20;
                if (dry) counts.push(trees.filter((p) => p.x >= x && p.x < x + cell && p.z >= z && p.z < z + cell).length);
            }
        }
        expect(counts.filter((n) => n <= 1).length / counts.length).toBeGreaterThan(0.3);
        expect(counts.filter((n) => n >= 10).length / counts.length).toBeGreaterThan(0.2);
    });

    it('spaces each tree by its own size, and knits the crowns inside a wood', () => {
        const list = T.filter((p) => p.lod === 'hero' && p.role !== 'shrub' && p.role !== 'open');
        const gap = (p) => list.reduce((m, q) => (q === p ? m : Math.min(m, Math.hypot(p.x - q.x, p.z - q.z))), Infinity);
        const median = (role) => {
            const g = list.filter((p) => p.role === role).map(gap).sort((x, y) => x - y);
            return g[Math.floor(g.length / 2)];
        };
        expect(median('giant')).toBeGreaterThan(median('canopy'));
        expect(median('canopy')).toBeGreaterThan(median('young'));
        const canopy = list.filter((p) => p.role === 'canopy');
        const touches = (p) => list.some((q) => q !== p && Math.hypot(p.x - q.x, p.z - q.z) < p.crownR + q.crownR);
        expect(canopy.filter(touches).length / canopy.length).toBeGreaterThan(0.8);
    });

    it('skirts its woods with shrubs and young trees, and leaves a few alone on the grass', () => {
        expect(FOREST.stats.byRole.shrub).toBeGreaterThan(300);
        expect(FOREST.stats.byRole.young).toBeGreaterThan(800);
        expect(FOREST.stats.byRole.open).toBeGreaterThan(100);
    });
});

describe('a grove\'s light', () => {
    it('is asked of every tree: shaded from the sun in the wood, open on the grass', () => {
        T.forEach((p) => {
            const sound = p.shadeTop >= -0.5 && p.shadeTop <= 0.96 && p.open >= 0.2 && p.open <= 1;
            if (!sound) refuse(p, `light ${p.shadeTop} ${p.open}`);
        });
        const mean = (list, k) => list.reduce((s, p) => s + p[k], 0) / list.length;
        const wood = T.filter((p) => p.lod === 'hero' && p.role === 'canopy');
        const open = T.filter((p) => p.lod === 'hero' && (p.role === 'open' || p.framing));
        expect(mean(wood, 'open')).toBeLessThan(mean(open, 'open') - 0.2);
        expect(mean(wood, 'shadeTop')).toBeGreaterThan(mean(open, 'shadeTop') + 0.15);
    });
});

describe('the budget', () => {
    it('draws few buckets: one a place and tier, whatever grows there', () => {
        expect(FOREST.buckets.size).toBeLessThanOrEqual(66);
        let n = 0;
        FOREST.buckets.forEach((b) => {
            n += b.items.length;
            b.items.forEach((p) => {
                if (p.lod !== b.lod || Math.floor(p.x / b.edge) !== Math.floor(b.centre.x / b.edge)) refuse(p, b.key);
            });
        });
        expect(n).toBe(T.length);
    });

    it('gives the near detail only to trees the eye comes near', () => {
        const { hero, mid } = forestLodDistanceForTier('High');
        const eye = (p) => {
            let best = Infinity;
            for (let t = 0.1; t < 0.8; t += 0.004) {
                const q = getOdysseyPathPointAt(t);
                best = Math.min(best, Math.hypot(q.x - p.x, q.y - (p.y + 8), q.z - p.z));
            }
            return best;
        };
        T.filter((p, i) => i % 97 === 0 && !p.framing).forEach((p) => {
            const d = eye(p);
            if (p.lod === 'hero') expect(d, at(p)).toBeLessThan(hero + 40);
            if (p.lod === 'mid') expect(d, at(p)).toBeLessThan(mid + 40);
            if (p.lod === 'far') expect(d, at(p)).toBeGreaterThan(mid - 40);
        });
        expect(FOREST.stats.byLod.hero).toBeGreaterThan(800);
        expect(FOREST.stats.byLod.hero).toBeLessThan(2200);
        expect(FOREST.stats.byLod.mid).toBeLessThan(6500);
    });

    it('thins a lower tier to a part of the same forest', () => {
        const low = scatterZonedForest(odysseyWorldHeight, { rail: RAIL, seaLevel: ODYSSEY_SEA_LEVEL, spacing: 24 });
        const key = (p) => `${p.id}|${p.x.toFixed(2)}|${p.z.toFixed(2)}`;
        const all = new Set(T.map(key));
        expect(low.stats.trees).toBeLessThan(FOREST.stats.trees * 0.7);
        expect(low.stats.trees).toBeGreaterThan(FOREST.stats.trees * 0.4);
        low.placements.forEach((p) => { if (!all.has(key(p))) refuse(p, 'new on the low tier'); });
    });

    it('is the same forest every time', () => {
        const again = scatterZonedForest(odysseyWorldHeight, { rail: RAIL, seaLevel: ODYSSEY_SEA_LEVEL });
        expect(again.placements.length).toBe(T.length);
        expect(JSON.stringify(again.placements[1234])).toBe(JSON.stringify(T[1234]));
        expect(JSON.stringify(again.placements.at(-1))).toBe(JSON.stringify(T.at(-1)));
    });
});
