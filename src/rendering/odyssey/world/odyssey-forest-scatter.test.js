import { describe, expect, it } from 'vitest';

import {
    buildShoreDistance, scatterZonedForest, shadeColourFor,
} from './odyssey-forest-scatter.js';
import {
    FOREST_BANDS, FOREST_VALUE_ROLES, ODYSSEY_FOREST_SPECIES, getForestSpecies,
} from './odyssey-forest-species.js';
import {
    ODYSSEY_SEA_LEVEL,
    odysseyWorldDetailWeight,
    odysseyWorldMacro,
    odysseyWorldRelief,
} from './odyssey-world-height.js';
import { getOdysseyPathPointAt } from '../path-utils.js';

/**
 * FOREST PLAN, WAVE 2 — the zoned scatter's gates.
 *
 * Every gate here is checkable without a GPU, which is the point: the scatter decides species,
 * colour, growth stage, LOD and DRAW COUNT, and draw count is the One World rebuild's own
 * structural claim (Lane A max 90). A scatter that quietly triples the draws would not show up
 * in a screenshot until the perf pair caught it two waves later.
 *
 * These run against the REAL height field and the REAL rail rather than stubs. A zone field
 * validated on a flat plane says nothing — every interesting behaviour here (band overlap,
 * tree-line thinning, LOD binning) is a response to the actual terrain.
 */

// The CPU height mirror, built the same way `buildReliefBake` does inside the renderer but
// without three.js: the analytic macro plus relief, weighted. Close enough to the baked
// bilinear mirror for scatter behaviour, and it keeps this suite device-free.
const heightAt = (x, z) => odysseyWorldMacro(x, z)
    + (odysseyWorldRelief(x, z) * odysseyWorldDetailWeight(x, z));

const RAIL = Array.from({ length: 48 }, (_, i) => getOdysseyPathPointAt(i / 47));

const run = (opts = {}) => scatterZonedForest(heightAt, { rail: RAIL, ...opts });

// One scatter, reused: at spacing 15 this walks a 234x234 grid, and rebuilding it per test
// would dominate the suite's runtime for no extra confidence.
const HIGH = run();
const LOW = run({ spacing: 24 });
/** The roster's green half — everything that is not a gold, a red or a blossom. */
const GREEN_SPECIES = new Set([
    'S1-shore-broadleaf', 'S2-workhorse-pine', 'S3-subalpine-fir', 'S5-cypress-spike',
]);

describe('the zoned scatter keeps the incumbent\'s measured rejections', () => {
    it('never places a tree below the shoreline or above the tree line', () => {
        HIGH.placements.forEach((p) => {
            expect(p.y).toBeGreaterThanOrEqual(ODYSSEY_SEA_LEVEL + 3);
            expect(p.y).toBeLessThanOrEqual(640);
        });
    });

    it('stays inside the scatter disc, and well inside the relief bake', () => {
        HIGH.placements.forEach((p) => {
            expect(Math.hypot(p.x - -220, p.z - -620)).toBeLessThanOrEqual(1750 + 1e-6);
            // The bake covers +-4500 with ClampToEdge; anything crossing it is extruded to the
            // horizon (the north-coast lesson). r=1750 about (-220,-620) is comfortably inside.
            expect(Math.abs(p.x)).toBeLessThan(4000);
            expect(Math.abs(p.z)).toBeLessThan(4000);
        });
    });

    it('rejects steep ground, so nothing stands on a cliff face', () => {
        const e = 4;
        HIGH.placements.slice(0, 400).forEach((p) => {
            const slope = Math.hypot(
                (heightAt(p.x + e, p.z) - heightAt(p.x - e, p.z)) / (2 * e),
                (heightAt(p.x, p.z + e) - heightAt(p.x, p.z - e)) / (2 * e),
            );
            expect(slope).toBeLessThanOrEqual(0.62);
        });
    });
});

describe('the zone field composes an island rather than confetti', () => {
    it('places every species, and none of them everywhere', () => {
        const ids = Object.keys(HIGH.stats.bySpecies);
        expect(ids.length).toBe(ODYSSEY_FOREST_SPECIES.length);
        ids.forEach((id) => {
            const spec = getForestSpecies(id);
            const n = HIGH.stats.bySpecies[id];
            const share = n / HIGH.stats.trees;
            // ⚠️ PRESENCE, then share — split when the grove species arrived. A destination
            // grove at 0.7% of 15,000 trees is ~110 trees, which is a real grove and exactly
            // its design; a 1% share floor would force it to stop being rare. Accent species
            // (grove/waterline-flagged) must simply EXIST in force; everything else keeps the
            // 1% floor that catches a dead species.
            // Accent = RARE BY DESIGN. Classified on the rarity knobs (`grove`, the anchor
            // role, a sub-1.0 weight) and no longer on `waterline`, which since the
            // 2026-08-15 shore reversal marks two weight-1.0 workhorses — a placement flag,
            // not a rarity one. Reading rarity off a placement flag made this floor say
            // "presence in force is enough" about the two commonest trees on the island.
            const accent = spec.grove || spec.role === 'anchor' || spec.weight < 1;
            if (accent) expect(n, id).toBeGreaterThan(60);
            else expect(share, id).toBeGreaterThan(0.01);
            expect(share, id).toBeLessThan(0.60);
        });
    });

    /**
     * The anchor species is the composition's black-note budget (§1b R2/R5: the reference
     * cypress row is near-black against luma-137 sand). Its scarcity is the whole point — a
     * dark punctuation that covers a third of the island is not punctuation, it is the mood.
     */
    it('keeps the dark anchor species rare on the ground, not just rare in the table', () => {
        const anchorIds = ODYSSEY_FOREST_SPECIES.filter((s) => s.role === 'anchor').map((s) => s.id);
        const anchorTrees = anchorIds.reduce((a, id) => a + (HIGH.stats.bySpecies[id] ?? 0), 0);
        expect(anchorTrees).toBeGreaterThan(0);
        expect(anchorTrees / HIGH.stats.trees).toBeLessThan(0.12);
    });

    /**
     * STANDS, NOT NOISE. If species were chosen per-tree at random, a tree's neighbours would
     * match it only at the base rate; a zone field must make them match far more often. This
     * is the numeric form of "one dominant hue per tree, in zones of several canopy diameters"
     * and it fails if the zone cell is shrunk toward per-tree jitter.
     */
    it('groups species into stands: neighbours agree far more often than chance', () => {
        const sample = HIGH.placements.filter((_, i) => i % 7 === 0).slice(0, 900);
        const base = Object.values(HIGH.stats.bySpecies)
            .reduce((a, n) => a + ((n / HIGH.stats.trees) ** 2), 0);
        let pairs = 0;
        let agree = 0;
        sample.forEach((p) => {
            HIGH.placements.forEach((q) => {
                if (q === p) return;
                if (Math.abs(q.x - p.x) > 60 || Math.abs(q.z - p.z) > 60) return;
                pairs += 1;
                if (q.speciesId === p.speciesId) agree += 1;
            });
        });
        expect(pairs).toBeGreaterThan(500);
        const local = agree / pairs;
        expect(local).toBeGreaterThan(base * 1.5);
        expect(local).toBeGreaterThan(0.5);
    });

    it('feathers band boundaries so no species draws a contour line across the island', () => {
        // ⚠️ MEASURED AGAINST THE SPECIES' OWN BAND WIDTH, not a fixed 40 u. The bands were
        // re-cut to the terrain's real distribution and the narrowest is now 37 u wide, so a
        // fixed threshold demands a spread the band cannot have — a test failing on correct
        // data. What matters is that a species occupies its band rather than an iso-line.
        const byId = {};
        HIGH.placements.forEach((p) => {
            (byId[p.speciesId] ??= []).push(p.y);
        });
        Object.entries(byId).forEach(([id, ys]) => {
            const band = FOREST_BANDS[getForestSpecies(id).band];
            const span = Math.max(...ys) - Math.min(...ys);
            expect(span, id).toBeGreaterThan((band.hi - band.lo) * 0.5);
        });
    });
});

describe('the draw budget holds — draw calls are the rebuild structural claim', () => {
    /**
     * ⚠️ THIS GATE REPLACED A PROXY. The plan asked for "at most 2 variants per chunk", which
     * was a stand-in for the draw budget written before the scatter could report one. It is
     * also not meaningful under the shipped bucketing: a far chunk is a 1,680 u square and
     * five species sharing one is expected, not a defect. The budget is now measured directly
     * — total buckets, and the buckets actually inside the CPU visibility gate at real
     * stations — which is the number Lane A's ceiling of 90 draws is about.
     */
    it('builds no more total buckets than the incumbent 40 chunks', () => {
        expect(HIGH.stats.draws).toBeLessThanOrEqual(44);
        expect(LOW.stats.draws).toBeLessThanOrEqual(44);
    });

    it('keeps visible buckets well inside the Lane A draw ceiling at every station', () => {
        // The world measured 53 total draws at p=0.42 with ~15 of them forest, against max 90.
        // Anything at or under 30 forest draws leaves the whole-world total in the mid-60s.
        [0.225, 0.30, 0.42].forEach((p) => {
            const rp = getOdysseyPathPointAt(p);
            let visible = 0;
            HIGH.buckets.forEach((b) => {
                if (Math.hypot(b.centre.x - rp.x, b.centre.z - rp.z) < 1450) visible += 1;
            });
            expect(visible, `station p=${p}`).toBeLessThanOrEqual(30);
            expect(visible, `station p=${p}`).toBeGreaterThan(0);
        });
    });

    it('coarsens the bucket grid with distance, which is what buys the budget', () => {
        const edges = { hero: new Set(), mid: new Set(), far: new Set() };
        HIGH.buckets.forEach((b) => edges[b.lod].add(b.edge));
        expect([...edges.hero]).toEqual([420]);
        expect([...edges.mid]).toEqual([840]);
        expect([...edges.far]).toEqual([1680]);
    });

    it('buckets by (chunk, species, LOD) and loses no tree in the process', () => {
        let total = 0;
        HIGH.buckets.forEach((b) => {
            total += b.items.length;
            b.items.forEach((p) => {
                expect(p.speciesId).toBe(b.speciesId);
                expect(p.lod).toBe(b.lod);
                expect(Math.floor(p.x / b.edge)).toBe(Number(b.chunk.split('|')[0]));
            });
        });
        expect(total).toBe(HIGH.placements.length);
    });
});

describe('density stays an art lever, not a perf regression channel', () => {
    it('lands within 15% of the incumbent count on both quality lanes', () => {
        // Incumbent, read from the live build: 15,427 high / 6,028 low.
        expect(HIGH.stats.trees).toBeGreaterThan(15427 * 0.85);
        expect(HIGH.stats.trees).toBeLessThan(15427 * 1.15);
        expect(LOW.stats.trees).toBeGreaterThan(6028 * 0.85);
        expect(LOW.stats.trees).toBeLessThan(6028 * 1.15);
    });

    it('bins LOD by distance to the rail, with all three tiers actually used', () => {
        expect(HIGH.stats.byLod.hero).toBeGreaterThan(0);
        expect(HIGH.stats.byLod.mid).toBeGreaterThan(0);
        expect(HIGH.stats.byLod.far).toBeGreaterThan(0);
        // Hero is the expensive tier; it must be the rarest, or the LOD chain is decorative.
        expect(HIGH.stats.byLod.hero).toBeLessThan(HIGH.stats.byLod.mid);
    });

    /**
     * LOD IS A PROPERTY OF THE CHUNK, not of the tree — the chunk is the batching unit, and a
     * 420 u square straddling a tier boundary would otherwise need two draws. So the contract
     * is about the FINE chunk's centre, and an individual tree may sit up to a half-diagonal
     * (~297 u) from it. Asserting per-tree distance instead is how a first cut of this test
     * failed against correct behaviour.
     */
    it('assigns LOD by the fine chunk centre distance to the rail', () => {
        const centreDist = (p) => {
            const cx = (Math.floor(p.x / 420) + 0.5) * 420;
            const cz = (Math.floor(p.z / 420) + 0.5) * 420;
            return Math.sqrt(Math.min(...RAIL.map((r) => ((cx - r.x) ** 2) + ((cz - r.z) ** 2))));
        };
        HIGH.placements.filter((p) => p.lod === 'hero').slice(0, 300)
            .forEach((p) => expect(centreDist(p)).toBeLessThanOrEqual(150 + 1e-6));
        HIGH.placements.filter((p) => p.lod === 'far').slice(0, 300)
            .forEach((p) => expect(centreDist(p)).toBeGreaterThan(700 - 1e-6));
    });
});

describe('per-instance colour carries the measured laws', () => {
    /**
     * §1b R3, enforced at the only place it can be enforced for every future palette: the
     * shade colour is DERIVED, never authored. Deeper and more saturated along the crown's own
     * hue axis — normalised blue must not rise and saturation must not fall.
     */
    it('derives a shade that is deeper and never desaturated, for every species', () => {
        ODYSSEY_FOREST_SPECIES.forEach((s) => {
            const shade = shadeColourFor(s.crown, s.role);
            const lumaOf = (c) => (0.2126 * c[0]) + (0.7152 * c[1]) + (0.0722 * c[2]);
            const satOf = (c) => {
                const mx = Math.max(...c);
                const mn = Math.min(...c);
                return mx === 0 ? 0 : (mx - mn) / mx;
            };
            const normB = (c) => c[2] / (c[0] + c[1] + c[2] || 1);
            expect(lumaOf(shade)).toBeLessThan(lumaOf(s.crown));
            expect(satOf(shade)).toBeGreaterThanOrEqual(satOf(s.crown) - 1e-6);
            expect(normB(shade)).toBeLessThanOrEqual(normB(s.crown) + 1e-6);
            // And it stays inside the species' measured value class.
            const ratio = lumaOf(shade) / lumaOf(s.crown);
            const recipe = FOREST_VALUE_ROLES[s.role];
            expect(ratio).toBeCloseTo(recipe.value, 2);
        });
    });

    /**
     * ⚠️ REWRITTEN when the hue ramp landed, and the distinction matters. The old assertion was
     * that per-tree hue is preserved EXACTLY — correct while the jitter was a uniform value
     * scale, and exactly why every gold tree was the same gold at a different brightness. The
     * reference grove runs pale gold → amber → deep red TREE BY TREE, so hue must vary.
     *
     * What must still hold is the rule the old test was protecting: **one authored identity,
     * never a rainbow.** So every tree's chromaticity must lie ON the segment between its
     * species' two authored ends — inside the ramp, never past either end, never off it.
     */
    it('spreads each tree along its species hue ramp and never off it', () => {
        const chroma = (c) => {
            const sum = c[0] + c[1] + c[2] || 1;
            return [c[0] / sum, c[1] / sum];
        };
        const bySpecies = new Map();
        HIGH.placements.forEach((p) => {
            if (!bySpecies.has(p.speciesId)) bySpecies.set(p.speciesId, []);
            bySpecies.get(p.speciesId).push(p);
        });
        bySpecies.forEach((list, id) => {
            const spec = getForestSpecies(id);
            const a = chroma(spec.crown);
            const b = chroma(spec.crownAlt ?? spec.crown);
            const lo = [Math.min(a[0], b[0]), Math.min(a[1], b[1])];
            const hi = [Math.max(a[0], b[0]), Math.max(a[1], b[1])];
            let spread = 0;
            list.slice(0, 400).forEach((p) => {
                const c = chroma(p.crown);
                // Inside the authored ramp, with float tolerance — never a hue the species
                // does not own.
                expect(c[0], `${id} normR`).toBeGreaterThanOrEqual(lo[0] - 1e-6);
                expect(c[0], `${id} normR`).toBeLessThanOrEqual(hi[0] + 1e-6);
                expect(c[1], `${id} normG`).toBeGreaterThanOrEqual(lo[1] - 1e-6);
                expect(c[1], `${id} normG`).toBeLessThanOrEqual(hi[1] + 1e-6);
                spread = Math.max(spread, Math.abs(c[0] - a[0]));
            });
            // And the ramp is actually USED — a species with two ends whose trees all sit at
            // one of them is the defect this test replaced, wearing a new face.
            if (spec.crownAlt) expect(spread, `${id} uses its ramp`).toBeGreaterThan(0.01);
        });
    });

    /**
     * The reds are an ACCENT, not the stand. Ref2's grove is gold-dominant with red
     * punctuating; an evenly-spread ramp would read as a fruit salad.
     */
    it('keeps the far end of each hue ramp a minority', () => {
        const spec = getForestSpecies('S4-gold-birch');
        const far = spec.crownAlt;
        const list = HIGH.placements.filter((p) => p.speciesId === spec.id);
        expect(list.length).toBeGreaterThan(50);
        // "Past the midpoint" measured on the ramp's dominant axis (red falls gold -> red).
        const mid = (spec.crown[1] + far[1]) / 2;
        const past = list.filter((p) => (p.crown[1] / (p.crown[0] + p.crown[1] + p.crown[2]))
            < (mid / (spec.crown[0] + mid + spec.crown[2]))).length;
        expect(past / list.length).toBeLessThan(0.45);
    });

    it('snow-dusts only the species authored for it, and only near the tree line', () => {
        let dusted = 0;
        HIGH.placements.forEach((p) => {
            const spec = getForestSpecies(p.speciesId);
            expect(p.snow).toBeGreaterThanOrEqual(0);
            expect(p.snow).toBeLessThanOrEqual(1);
            if (!spec.snow) expect(p.snow).toBe(0);
            if (p.snow > 0) {
                // 385 is the measured top of the plantable range, not the nominal snow line —
                // see the scatter's `snowOnset` note. A gate written against 560 passed on
                // zero instances, which is the shape of a vacuous test.
                expect(p.y).toBeGreaterThan(385);
                dusted += 1;
            }
        });
        // The subalpine band is real terrain, so this must actually fire.
        expect(dusted).toBeGreaterThan(0);
    });
});

describe('the framing trees stand where they were authored', () => {
    it('places every framing tree that has ground to stand on, at hero LOD, seated on the mirror', () => {
        const framed = HIGH.placements.filter((p) => p.framing);
        // The roster excludes the underwater stations by survey; everything else must stand.
        expect(framed.length).toBeGreaterThanOrEqual(6);
        framed.forEach((p) => {
            expect(p.lod).toBe('hero');
            expect(p.stageId).toBe('old');
            // Seated on the SAME height mirror as everything else — terrain is authoritative,
            // so a framing tree can never float above a re-carved slope.
            expect(Math.abs(p.y - heightAt(p.x, p.z))).toBeLessThan(1e-6);
            expect(p.y).toBeGreaterThanOrEqual(ODYSSEY_SEA_LEVEL + 3);
        });
    });

    it('drops a framing site the terrain has drowned rather than floating it', () => {
        // A site authored in the lake must vanish, not swim: feed the scatter one impossible
        // framing entry and assert it is absent.
        const r = scatterZonedForest(heightAt, {
            rail: RAIL,
            spacing: 24,
            framing: [{ x: 0, z: 0, species: 'S1-shore-broadleaf' }],
        });
        expect(r.placements.filter((p) => p.framing)).toHaveLength(0);
    });
});

describe('the scatter is deterministic, because a forest that reshuffles cannot be reviewed', () => {
    it('produces an identical forest from identical inputs', () => {
        const a = run();
        const b = run();
        expect(a.stats).toEqual(b.stats);
        expect(a.placements.length).toBe(b.placements.length);
        for (let i = 0; i < a.placements.length; i += 97) {
            expect(a.placements[i]).toEqual(b.placements[i]);
        }
    });

    it('changes with the zone cell, so the zone field is genuinely wired', () => {
        // If `zoneCell` were ignored, the species assignment would be identical — the
        // declared-not-wired failure mode, caught by construction rather than by review.
        const wide = run({ zoneCell: 1500 });
        const same = HIGH.placements
            .filter((p, i) => wide.placements[i] && wide.placements[i].speciesId === p.speciesId);
        expect(same.length).toBeLessThan(HIGH.placements.length * 0.95);
    });
});

/**
 * THE SHORE COMPOSITION (owner decision, reversed 2026-08-15 — and reversed decisions are
 * exactly the ones a test has to hold).
 *
 * The waterline shipped on 2026-08-14 as an AUTUMN mix, at the owner's request: gold birch and
 * red maple boosted below y=325. After the ground overhaul landed, the owner reversed it —
 * against the new green meadow the gold canopy sat ON the ground instead of with it, and
 * flattened the one place the ground had gained the most.
 *
 * What ships now is a THREE-BAND composition rather than a repaint, and each band is asserted
 * here because two of them were discovered by measurement after the obvious fix failed:
 *
 *  1. below 306 — the green fringe. The greens carry the water's edge.
 *  2. 306..326 — the autumn body. Moving the boost to the greens alone took this strip to
 *     87-100% green and the island's gold birch from 26% to 7%: the autumn shore existed ONLY
 *     because a boost put it there, so removing that boost deletes the autumn rather than
 *     rebalancing it. The band above the fringe therefore keeps its own boost.
 *  3. above 326 — already 86-92% green with no clause at all.
 *
 * And the red maple must survive. It is an owner-requested species by name, and the first cut
 * of this reversal took it to 0.2% of the island by moving its band; a species that exists only
 * in the table is the defect this repo has shipped before (the cypress, at weight 0.18).
 */
/**
 * THE ISLAND'S TWO SIDES (owner direction, 2026-08-15 — the third shape, and the one that holds).
 *
 * Two earlier shapes were rejected on pictures, and the assertions here are written so neither
 * can come back unnoticed. Autumn AT the waterline died when the ground turned green under it.
 * A green fringe BANDED (first by altitude, then by distance to water) died because a band has a
 * characteristic width and therefore reads as a contour line at some viewing distance — the
 * owner's words were "I dont like this belt and contour line".
 *
 * What ships is REGIONAL, which is what the references do: the island has an autumn side and a
 * green side, the cherry grove sits on the seam, and the seam wanders. A region has no width, so
 * there is no distance at which it can read as a band.
 */
describe('the island has an autumn side and a green side, seamed at the cherry grove', () => {
    const AXIS = [0.891, -0.455];
    const SPLIT = 295;
    const FEATHER = 420;
    const regionOf = (t) => Math.max(0, Math.min(
        1,
        ((((t.x * AXIS[0]) + (t.z * AXIS[1])) - SPLIT) / FEATHER) + 0.5,
    ));
    const SITES = HIGH.placements.map((t) => ({ ...t, region: regionOf(t) }));
    const greenShare = (list) => list.filter((t) => GREEN_SPECIES.has(t.speciesId)).length
        / Math.max(1, list.length);

    it('keeps the LEFT side green', () => {
        const left = SITES.filter((t) => t.region < 0.30);
        expect(left.length).toBeGreaterThan(1000);
        expect(greenShare(left)).toBeGreaterThan(0.85);
    });

    it('makes the RIGHT side read autumn', () => {
        const right = SITES.filter((t) => t.region > 0.70);
        expect(right.length).toBeGreaterThan(1000);
        expect(greenShare(right)).toBeLessThan(0.45);
    });

    /**
     * ...but NOT a monoculture. At full strength the autumn side measured 1% green and the
     * island's workhorse pine collapsed from 22% to 5%: the golds stop reading once nothing dark
     * stands in them. This is the assertion that catches someone "strengthening" the effect.
     */
    it('leaves dark conifer standing inside the autumn side', () => {
        const right = SITES.filter((t) => t.region > 0.70);
        expect(greenShare(right)).toBeGreaterThan(0.12);
    });

    /**
     * The seam is where the cherry grove is — that is the whole composition, and it is the one
     * relationship a future palette edit could break silently.
     */
    it('seams the two sides at the cherry grove', () => {
        const blossom = SITES.filter((t) => t.speciesId === 'S7-pink-blossom');
        expect(blossom.length).toBeGreaterThan(60);
        const mean = blossom.reduce((a, t) => a + t.region, 0) / blossom.length;
        expect(mean).toBeGreaterThan(0.25);
        expect(mean).toBeLessThan(0.75);
    });

    it('keeps a green apron at the water on BOTH sides', () => {
        // The owner's earlier request, kept at a third of its old width so it reads as a
        // shoreline rather than as the belt that replaced it.
        const shoreAt = buildShoreDistance(heightAt, ODYSSEY_SEA_LEVEL);
        const edge = HIGH.placements.filter((t) => shoreAt(t.x, t.z) < 45);
        expect(edge.length).toBeGreaterThan(150);
        expect(greenShare(edge)).toBeGreaterThan(0.80);
    });

    it('keeps the owner-requested red maple alive on the island', () => {
        expect(HIGH.stats.bySpecies['S6-red-maple'] || 0).toBeGreaterThan(200);
    });

    it('keeps the gold birch a real mass, not a garnish', () => {
        expect((HIGH.stats.bySpecies['S4-gold-birch'] || 0) / HIGH.stats.trees).toBeGreaterThan(0.10);
    });
});
