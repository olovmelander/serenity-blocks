import { FOREST_LOD_DISTANCE, forestColours } from './odyssey-forest-species.js';
import {
    FOREST_SPECIMENS, forestFarIndex, forestSkirt, forestSpecimenIndex,
} from './odyssey-forest-models-decode.js';
import {
    FOREST_BEACH, FOREST_CEILINGS, FOREST_COMMUNITIES, FOREST_CYPRESS_ROWS, FOREST_DISC, FOREST_HEROES, clamp01, forestGroundAt,
    forestTarnOpen, hash2, patchNoise, siteOnNorthBeach, siteWet, smooth, standAt,
} from './odyssey-forest-composition.js';
import { bakeForestFloorData, forestClosure, forestFloorSites } from './odyssey-forest-floor.js';
import { FOREST_ANIMAL_GROUND, FOREST_ANIMAL_REACH, FOREST_ROCKS } from './odyssey-forest-keepouts.js';
import { ODYSSEY_MEADOW_CLEARING, odysseyMeadowOpenness } from './odyssey-meadow-clearing.js';
import { railSeesForestSite } from './odyssey-forest-visibility.js';
import { ODYSSEY_WORLD_SUN } from '../chapter-environments/shared/chapter-profile.js';

export { siteOnNorthBeach };

/**
 * THE FOREST'S SCATTER (2026-11-24): the composition (odyssey-forest-composition.js) planted.
 *
 * Not a jittered grid: a wood is planted the way one grows. The heroes stand first; then the giants, far
 * apart in the hearts of the woods; then the canopy, as close as crowns allow; then the wood's edge
 * (smaller, broader, younger); then the young trees that fit in what is left; then the shrubs, thick
 * along the edge and thin under the canopy; and last the few that stand alone on the grass. Every tree
 * keeps the ground its own crown needs from the bigger ones already there, so spacing follows size: wide
 * round an old oak, tight in a pole stand, crowns touching inside a wood and daylight at its edge. When the
 * trees stand, the wood's floor is read off them and its ferns grow there (odyssey-forest-floor.js).
 *
 * Then the light: each tree is told how high up its neighbours shade it from the sun and how much sky
 * its foot sees, so a grove is lit as one thing (odyssey-forest-material.js).
 *
 * ⚠️ DETERMINISTIC, and it runs in the bake worker: pure arithmetic over a height function, no three.js.
 */

/** Bucket edge by tier, u: near buckets cull tightly, far ones batch. */
export const FOREST_CHUNK_BY_LOD = Object.freeze({ hero: 300, mid: 640, far: 1750 });
/** ...and the floor's plants, which are small: more ground to a draw. */
export const FOREST_CHUNK_FLOOR = 640;

/**
 * A draw's size classes, by cards. Every tree in a draw is given as many slots as its biggest one needs, so
 * trees of like size share one: these cuts leave about a fifth of the slots idle (two classes left 44 %).
 */
const CLASS_CUTS = Object.freeze({ hero: [60, 110, 160, 220], mid: [24, 45, 70], far: [] });
/** A fern's draw is its own: a drift of them, or one alone. */
const FLOOR_CUTS = Object.freeze({ hero: [18], mid: [] });

/** The grids the candidates come from: finer where the eye comes near. */
const ZONES = Object.freeze([
    Object.freeze({
        from: 0, to: 225, step: 3.3, salt: 11,
    }),
    Object.freeze({
        from: 225, to: 545, step: 5.1, salt: 12,
    }),
    Object.freeze({
        from: 545, to: Infinity, step: 8.6, salt: 13,
    }),
]);

/**
 * The planting's passes, biggest first. `pack` is the share of two crowns' reach kept between their
 * trunks (below ~0.55 the crowns knit), `size` the range of scales, `cover` the part of the wood they
 * stand in, `odds` a candidate's chance there.
 */
const PASSES = Object.freeze([
    Object.freeze({
        role: 'giant', cover: [0.80, 2], odds: [0.030, 0.030, 0.030], pack: 0.62, size: [0.95, 1.20],
    }),
    Object.freeze({
        role: 'canopy', cover: [0.48, 2], odds: [0.90, 0.90, 0.80], pack: 0.50, size: [0.78, 1.14],
    }),
    Object.freeze({
        role: 'edge', cover: [0.24, 0.58], odds: [0.26, 0.42, 0.60], pack: 0.58, size: [0.70, 1.02],
    }),
    Object.freeze({
        role: 'young', cover: [0.34, 2], odds: [0.16, 0.22, 0.10], pack: 0.46, size: [0.75, 1.25],
    }),
    Object.freeze({
        role: 'shrub', cover: [0.18, 0.60], odds: [0.16, 0.16, 0], pack: 0.42, size: [0.70, 1.25],
    }),
    Object.freeze({
        role: 'shrub', cover: [0.60, 2], odds: [0.030, 0.020, 0], pack: 0.40, size: [0.65, 1.1],
    }),
    Object.freeze({
        role: 'open', cover: [0, 0.18], odds: [0.0050, 0.0110, 0.026], pack: 1.25, size: [0.80, 1.15],
    }),
]);

/** The boulders' own clearance of a trunk (ODYSSEY_BOULDERS.treeClear), and a hand over; a fern's of the stone. */
const ROCK_CLEAR = 5.2;
const ROCK_CLEAR_FLOOR = 0.6;

/** Whether a trunk whose low growth reaches `skirt` u may stand at (x, z): off the rocks and the animals' ground. */
const keepouts = (() => {
    const cell = 24;
    const grid = new Map();
    const key = (i, j) => `${i}|${j}`;
    const put = (x, z, r, rock) => {
        const i = Math.floor(x / cell);
        const j = Math.floor(z / cell);
        for (let b = j - 1; b <= j + 1; b += 1) {
            for (let a = i - 1; a <= i + 1; a += 1) {
                const k = key(a, b);
                if (!grid.has(k)) grid.set(k, []);
                grid.get(k).push({
                    x, z, r, rock,
                });
            }
        }
    };
    FOREST_ROCKS.forEach(([x, z, r]) => put(x, z, r + ROCK_CLEAR, true));
    FOREST_ANIMAL_GROUND.forEach(([x, z]) => put(x, z, FOREST_ANIMAL_REACH, false));
    return (x, z, skirt, rockClear = ROCK_CLEAR) => {
        const list = grid.get(key(Math.floor(x / cell), Math.floor(z / cell)));
        if (!list) return true;
        for (let i = 0; i < list.length; i += 1) {
            const k = list[i];
            const keep = k.r + (k.rock ? rockClear - ROCK_CLEAR : (skirt * 0.6) + 0.7);
            const dx = k.x - x;
            const dz = k.z - z;
            if ((dx * dx) + (dz * dz) < keep * keep) return false;
        }
        return true;
    };
})();

/**
 * DISTANCE TO THE WATERLINE, u, as a sampled field (a two-pass chamfer transform over a coarse mask).
 */
export function buildShoreDistance(heightAt, seaLevel, res = 384) {
    const extent = 9000;
    const step = extent / res;
    const origin = -extent / 2;
    const BIG = 1e9;
    const d = new Float32Array(res * res);
    for (let j = 0; j < res; j += 1) {
        const z = origin + (j * step);
        for (let i = 0; i < res; i += 1) d[(j * res) + i] = heightAt(origin + (i * step), z) > seaLevel ? BIG : 0;
    }
    const N = 5;
    const D = 7;
    const at = (i, j) => ((i < 0 || j < 0 || i >= res || j >= res) ? BIG : d[(j * res) + i]);
    for (let j = 0; j < res; j += 1) {
        for (let i = 0; i < res; i += 1) {
            const k = (j * res) + i;
            d[k] = Math.min(d[k], at(i - 1, j) + N, at(i, j - 1) + N, at(i - 1, j - 1) + D, at(i + 1, j - 1) + D);
        }
    }
    for (let j = res - 1; j >= 0; j -= 1) {
        for (let i = res - 1; i >= 0; i -= 1) {
            const k = (j * res) + i;
            d[k] = Math.min(d[k], at(i + 1, j) + N, at(i, j + 1) + N, at(i + 1, j + 1) + D, at(i - 1, j + 1) + D);
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
 * The rail, sampled on a coarse grid over the disc: the distance to its track, and how near the eye that
 * rides it ever comes to the ground there (the climb flies hundreds of units over the massif's flanks).
 */
function buildRailDistance(rail, heightAt) {
    if (!rail.length) return { track: () => 0, eye: () => Infinity };
    const { cx, cz, radius } = FOREST_DISC;
    const step = 22;
    const n = Math.ceil((radius * 2) / step) + 3;
    const x0 = cx - radius - step;
    const z0 = cz - radius - step;
    const f = new Float32Array(n * n);
    const g = new Float32Array(n * n);
    // The rail as a polyline: its samples are ~30 u apart near the island.
    for (let j = 0; j < n; j += 1) {
        for (let i = 0; i < n; i += 1) {
            const x = x0 + (i * step);
            const z = z0 + (j * step);
            let best = Infinity;
            let near = Infinity;
            const ground = heightAt(x, z) + 8;
            for (let k = 0; k + 1 < rail.length; k += 1) {
                const a = rail[k];
                const b = rail[k + 1];
                const dx = b.x - a.x;
                const dz = b.z - a.z;
                const l2 = (dx * dx) + (dz * dz);
                const t = l2 > 0 ? clamp01((((x - a.x) * dx) + ((z - a.z) * dz)) / l2) : 0;
                const ex = x - (a.x + (dx * t));
                const ez = z - (a.z + (dz * t));
                const d2 = (ex * ex) + (ez * ez);
                if (d2 < best) best = d2;
                const up = a.y === undefined ? 0 : (a.y + ((b.y - a.y) * t)) - ground;
                if (d2 + (up * up) < near) near = d2 + (up * up);
            }
            f[(j * n) + i] = Math.sqrt(best);
            g[(j * n) + i] = Math.sqrt(near);
        }
    }
    const read = (p) => (x, z) => {
        const gx = Math.max(0, Math.min(n - 1.001, (x - x0) / step));
        const gz = Math.max(0, Math.min(n - 1.001, (z - z0) / step));
        const i = Math.floor(gx);
        const j = Math.floor(gz);
        const u = gx - i;
        const v = gz - j;
        const k = (j * n) + i;
        return (((p[k] * (1 - u)) + (p[k + 1] * u)) * (1 - v)) + (((p[k + n] * (1 - u)) + (p[k + n + 1] * u)) * v);
    };
    return { track: read(f), eye: read(g) };
}

/** The trunks already standing, by place. */
function createStand() {
    const cell = 9;
    const { cx, cz, radius } = FOREST_DISC;
    const n = Math.ceil((radius * 2) / cell) + 4;
    const x0 = cx - radius - (2 * cell);
    const z0 = cz - radius - (2 * cell);
    const head = new Int32Array(n * n).fill(-1);
    const next = [];
    const px = [];
    const pz = [];
    const pr = [];
    let maxR = 1;
    const at = (v, o) => Math.max(0, Math.min(n - 1, Math.floor((v - o) / cell)));
    return {
        add(x, z, r) {
            const k = (at(z, z0) * n) + at(x, x0);
            next.push(head[k]);
            head[k] = px.length;
            px.push(x);
            pz.push(z);
            pr.push(r);
            if (r > maxR) maxR = r;
        },
        /** Whether a crown of reach `r` fits at (x, z), `pack` of the two reaches from every trunk. */
        fits(x, z, r, pack) {
            const reach = (r + maxR) * pack;
            const i0 = at(x - reach, x0);
            const i1 = at(x + reach, x0);
            const j0 = at(z - reach, z0);
            const j1 = at(z + reach, z0);
            for (let j = j0; j <= j1; j += 1) {
                for (let i = i0; i <= i1; i += 1) {
                    for (let k = head[(j * n) + i]; k >= 0; k = next[k]) {
                        const dx = px[k] - x;
                        const dz = pz[k] - z;
                        const keep = (pr[k] + r) * pack;
                        if ((dx * dx) + (dz * dz) < keep * keep) return false;
                    }
                }
            }
            return true;
        },
    };
}

/** [[specimen index, weight, reach]] for every role of every community, resolved once. */
const ROSTER = (() => {
    const out = {};
    Object.entries(FOREST_COMMUNITIES).forEach(([name, c]) => {
        out[name] = { patch: c.patch };
        ['giant', 'canopy', 'edge', 'young', 'shrub', 'open'].forEach((role) => {
            out[name][role] = c[role].map(([id, weight], k) => {
                const index = forestSpecimenIndex(id);
                if (index < 0) throw new Error(`[OdysseyForest] no specimen "${id}"`);
                return {
                    index, weight, salt: 400 + (index * 3) + k,
                };
            }).filter((e) => e.weight > 0);
        });
    });
    return out;
})();

/** Who stands here: the role's weights, each kind in its own patches. */
function pick(list, patch, x, z, r) {
    let total = 0;
    const w = [];
    for (let i = 0; i < list.length; i += 1) {
        const n = patchNoise(x, z, patch, list[i].salt);
        const k = list[i].weight * (0.18 + (2.6 * n * n * n));
        w.push(k);
        total += k;
    }
    let t = r * total;
    for (let i = 0; i < list.length; i += 1) {
        t -= w[i];
        if (t <= 0) return list[i].index;
    }
    return list[list.length - 1].index;
}

const BROADLEAF = new Set(['oak', 'beech', 'birch', 'aspen', 'maple', 'cherry', 'willow', 'hazel', 'hawthorn', 'thicket']);

/**
 * Plant the forest.
 * @param {(x:number,z:number)=>number} heightAt the CPU height mirror the ground is drawn from
 * @param {object} [opts]
 * @param {Array<{x:number,z:number}>} [opts.rail] the rail's samples (the world does not know the path)
 * @param {number} [opts.spacing] the quality's tree spacing: 15 is the whole forest, more thins it
 * @param {{hero:number, mid:number}} [opts.lodDistance] the tier's distances
 * @param {'hero'|'mid'|'far'} [opts.forceLod] pin every tree to one tier (an experiment lever)
 * @param {boolean} [opts.visibilityCull] drop trees the rail can never see (ADR-0015: one flag back)
 * @param {boolean} [opts.meadowClearing] keep the wild horses' meadow open
 */
export function scatterZonedForest(heightAt, {
    visibilityCull = true,
    forceLod = null,
    lodDistance = null,
    spacing = 15,
    seaLevel = 287.31,
    meadowClearing = true,
    rail = [],
    heroes = FOREST_HEROES,
} = {}) {
    const { cx, cz, radius } = FOREST_DISC;
    const heroD = lodDistance?.hero ?? FOREST_LOD_DISTANCE.hero;
    const midD = lodDistance?.mid ?? FOREST_LOD_DISTANCE.mid;
    // A lower tier keeps a nested share of the scattered trees (never the heroes).
    const keep = Math.min(1, (15 / spacing) ** 1.15);
    const shoreAt = buildShoreDistance(heightAt, seaLevel);
    const railField = buildRailDistance(rail, heightAt);
    const railAt = railField.track;
    const eyeAt = railField.eye;
    const stand = createStand();
    const placements = [];
    const meadowCleared = [];
    // Every tree that stands, drawn on this tier or not: the floor is read off them.
    const standing = [];

    const lodAt = (d) => {
        if (forceLod) return forceLod;
        // No rail to measure from (a test's world): the heroes are near, all else is far.
        if (!rail.length) return d <= 0 ? 'hero' : 'far';
        if (d <= heroD) return 'hero';
        return d <= midD ? 'mid' : 'far';
    };

    /** Put a tree down (its ground is already judged). */
    const plant = (index, x, z, y, o) => {
        const spec = FOREST_SPECIMENS[index];
        const lod = lodAt(o.dEye);
        if (lod === 'far' && forestFarIndex(spec.id) < 0) return;
        const colours = forestColours(spec.species, { hue: o.hue, value: o.value, tint: o.tint ?? null });
        placements.push({
            x,
            y,
            z,
            specimen: index,
            id: spec.id,
            speciesId: spec.species,
            stageId: spec.stage,
            role: o.role,
            wood: o.wood,
            lod,
            dRail: o.dRail,
            dEye: o.dEye,
            scale: o.scale,
            scaleY: o.scaleY,
            // The crown's reach and the tree's height in the world: what every clearance is asked of.
            crownR: spec.reach * o.scale,
            height: spec.height * o.scaleY,
            // ...and what stands of it below an animal's back.
            skirt: forestSkirt(index) * o.scale,
            rot: o.rot,
            leanX: o.leanX ?? 0,
            leanZ: o.leanZ ?? 0,
            phase: o.rot * 3.7,
            crown: colours.crown,
            shade: colours.shade,
            trunk: colours.trunk,
            shadeTop: -0.5,
            open: 1,
            ...(o.hero ? { framing: true } : {}),
            ...(o.fleck ? { fleck: true } : {}),
        });
    };

    // ── the heroes ──
    const clears = [];
    // Under the water, or on its sand (FOREST_BEACH).
    const onBeach = (x, z, y) => y < seaLevel + 1.5
        || (y < seaLevel + FOREST_BEACH.top && shoreAt(x, z) < FOREST_BEACH.reach);
    heroes.forEach((h, k) => {
        const index = forestSpecimenIndex(h.id);
        if (index < 0) throw new Error(`[OdysseyForest] no specimen "${h.id}"`);
        const y = heightAt(h.x, h.z);
        if (onBeach(h.x, h.z, y) || siteWet(h.x, h.z)) return;
        const spec = FOREST_SPECIMENS[index];
        plant(index, h.x, h.z, y, {
            role: 'hero',
            wood: 'hero',
            hero: true,
            dRail: railAt(h.x, h.z),
            dEye: rail.length ? Math.min(eyeAt(h.x, h.z), heroD) : 0,
            scale: h.scale,
            scaleY: h.scale,
            rot: h.rot,
            hue: h.hue ?? (0.15 + (0.35 * hash2(k, 977, 5))),
            value: 0.5 + ((hash2(k, 977, 6) - 0.5) * 0.4),
        });
        stand.add(h.x, h.z, spec.reach * h.scale);
        standing.push({
            x: h.x, z: h.z, index, scale: h.scale, role: 'hero',
        });
        clears.push({ x: h.x, z: h.z, r: h.clear });
    });
    FOREST_CYPRESS_ROWS.forEach((row, ri) => {
        const tall = forestSpecimenIndex('cypress-tall');
        const young = forestSpecimenIndex('cypress-young');
        for (let k = 0; k < row.count; k += 1) {
            const t = k / Math.max(1, row.count - 1);
            const x = row.x0 + ((row.x1 - row.x0) * t) + ((hash2(k, ri, 71) - 0.5) * 3.2);
            const z = row.z0 + ((row.z1 - row.z0) * t) + ((hash2(k, ri, 72) - 0.5) * 3.2);
            const y = heightAt(x, z);
            if (onBeach(x, z, y) || siteWet(x, z)) continue;
            const index = hash2(k, ri, 73) < 0.28 ? young : tall;
            const scale = 0.85 + (0.35 * hash2(k, ri, 74));
            plant(index, x, z, y, {
                role: 'hero',
                wood: 'hero',
                hero: true,
                dRail: railAt(x, z),
                dEye: eyeAt(x, z),
                scale,
                scaleY: scale,
                rot: hash2(k, ri, 75) * 6.28,
                hue: hash2(k, ri, 76),
                value: 0.5,
            });
            stand.add(x, z, FOREST_SPECIMENS[index].reach * scale);
            clears.push({ x, z, r: 4 });
        }
    });

    // ── the candidates ──
    const cand = [];
    ZONES.forEach((zone, zi) => {
        const n = Math.ceil((radius * 2) / zone.step);
        const lo = Math.max(0, zone.from);
        for (let j = 0; j < n; j += 1) {
            const z0 = (cz - radius) + (j * zone.step);
            const half2 = (radius * radius) - ((z0 - cz) * (z0 - cz));
            if (half2 <= 0) continue;
            const half = Math.sqrt(half2);
            const i0 = Math.max(0, Math.floor((radius - half) / zone.step));
            const i1 = Math.min(n - 1, Math.ceil((radius + half) / zone.step));
            for (let i = i0; i <= i1; i += 1) {
                const x = (cx - radius) + (i * zone.step) + ((hash2(i, j, zone.salt) - 0.5) * zone.step * 0.98);
                const z = z0 + ((hash2(i, j, zone.salt + 20) - 0.5) * zone.step * 0.98);
                const dEye = eyeAt(x, z);
                if (rail.length && (dEye < lo || dEye >= zone.to)) continue;
                const dRail = railAt(x, z);
                if (!rail.length && zi !== 2) continue;
                const y = heightAt(x, z);
                if (y < seaLevel + 1.5) continue;
                const shore = shoreAt(x, z);
                if (y < seaLevel + FOREST_BEACH.top && shore < FOREST_BEACH.reach) continue;
                const e = 4;
                const hx0 = heightAt(x - e, z);
                const hx1 = heightAt(x + e, z);
                const hz0 = heightAt(x, z - e);
                const hz1 = heightAt(x, z + e);
                const slope = Math.hypot((hx1 - hx0) / (2 * e), (hz1 - hz0) / (2 * e));
                if (slope > 1.28) continue;
                if (siteWet(x, z)) continue;
                // Fold or rib: only the slopes ask (four more heights a site).
                const w = 26;
                const hollow = y < 318 ? 0
                    : (((heightAt(x - w, z) + heightAt(x + w, z) + heightAt(x, z - w) + heightAt(x, z + w)) / 4) - y) / (w * 4);
                const g = forestGroundAt(x, z, y, slope, hollow, shore, dRail);
                // The tarn's meadow stays open but for the clumps authored on its far bank.
                if (forestTarnOpen(x, z, y) && !(g.wood === 'waterside' && g.cover > 0.3)) continue;
                const roll = hash2(i, j, zone.salt + 40);
                if (g.cover < 0.18 && roll > 0.10) continue;
                cand.push({
                    x, z, y, slope, dRail, dEye, zi, cover: g.cover, wood: g.wood, i, j, salt: zone.salt, roll,
                });
            }
        }
    });

    // ── the planting ──
    PASSES.forEach((pass, pi) => {
        // In three rounds, each a third of the pass's candidates, so no corner of the island goes first.
        const rounds = [[], [], []];
        for (let k = 0; k < cand.length; k += 1) {
            const c = cand[k];
            if (c.cover < pass.cover[0] || c.cover >= pass.cover[1]) continue;
            const odds = pass.odds[c.zi];
            if (odds <= 0) continue;
            // `open` was thinned when the candidates were gathered; its odds are of the ground, not of them.
            const chance = pass.role === 'open' ? odds * 10 : odds;
            if (hash2(c.i, c.j, c.salt + 101 + (pi * 10)) > chance) continue;
            rounds[Math.floor(hash2(c.i, c.j, c.salt + 100 + (pi * 10)) * 3)].push(c);
        }
        for (let q = 0; q < 3; q += 1) {
            for (let k = 0; k < rounds[q].length; k += 1) {
                const c = rounds[q][k];
                // A wood has gaps: where an old one fell.
                if (pass.role === 'canopy' && patchNoise(c.x, c.z, 24, 351) < 0.17) continue;
                const roster = ROSTER[c.wood];
                const list = roster[pass.role];
                if (!list.length) continue;
                let index = pick(list, roster.patch, c.x, c.z, hash2(c.i, c.j, c.salt + 102 + (pi * 10)));
                let spec = FOREST_SPECIMENS[index];
                const broad = BROADLEAF.has(spec.species);
                if (broad && c.slope > 0.60) continue;
                if (!broad && c.slope > 0.86 && c.wood !== 'treeline') continue;
                if (c.zi === 2 && forestFarIndex(spec.id) < 0) {
                    const other = list.find((e) => forestFarIndex(FOREST_SPECIMENS[e.index].id) >= 0);
                    if (!other) continue;
                    ({ index } = other);
                    spec = FOREST_SPECIMENS[index];
                }
                const h1 = hash2(c.i, c.j, c.salt + 103 + (pi * 10));
                const h2 = hash2(c.i, c.j, c.salt + 104 + (pi * 10));
                // Altitude stunts: smaller and broader toward the treeline.
                const high = smooth(372, 470, c.y);
                const stunt = broad ? 1 : 1 - (0.42 * high);
                const rise = pass.role === 'canopy' ? smooth(0.48, 0.85, c.cover) * 0.12 : 0;
                const scale = (pass.size[0] + ((pass.size[1] - pass.size[0]) * h1) + rise) * stunt;
                const r = spec.reach * scale;
                const pack = pass.pack * (c.wood === 'aspen' || c.wood === 'montane' ? 0.96 : 1);
                if (!stand.fits(c.x, c.z, r, pack)) continue;
                let blocked = false;
                for (let b = 0; b < clears.length; b += 1) {
                    const dx = clears[b].x - c.x;
                    const dz = clears[b].z - c.z;
                    if ((dx * dx) + (dz * dz) < clears[b].r * clears[b].r) { blocked = true; break; }
                }
                if (blocked || !keepouts(c.x, c.z, forestSkirt(index) * scale)) continue;
                const top = c.y + (spec.height * scale * 1.08);
                if (FOREST_CEILINGS.some(([ax, az, ar, ay]) => top > ay && Math.hypot(c.x - ax, c.z - az) < ar)) continue;
                stand.add(c.x, c.z, r);
                const kept = keep >= 1 || hash2(c.i, c.j, c.salt + 105) <= keep;
                if (visibilityCull && !railSeesForestSite(c.x, c.z)) continue;
                if (meadowClearing) {
                    const open = odysseyMeadowOpenness(c.x, c.z);
                    const m = hash2(c.i, c.j, c.salt + 106);
                    if (open >= 1 ? m > ODYSSEY_MEADOW_CLEARING.lone : m < open) {
                        if (kept) meadowCleared.push({ x: c.x, z: c.z });
                        continue;
                    }
                }
                standing.push({
                    x: c.x, z: c.z, index, scale, role: pass.role,
                });
                if (!kept) continue;
                const gold = c.wood === 'aspen' || c.wood === 'maple';
                const clone = gold ? standAt(c.x, c.z, 104, 231).c : patchNoise(c.x, c.z, 120, 361);
                const own = hash2(c.i, c.j, c.salt + 107);
                let lean = broad ? 0.055 : 0.022;
                if (spec.species === 'stone-pine') lean = 0.10;
                plant(index, c.x, c.z, c.y, {
                    role: pass.role,
                    wood: c.wood,
                    dRail: c.dRail,
                    dEye: c.dEye,
                    scale,
                    scaleY: scale * (0.93 + (0.15 * h2)) * (1 - (0.10 * high)),
                    rot: hash2(c.i, c.j, c.salt + 108) * Math.PI * 2,
                    leanX: (hash2(c.i, c.j, c.salt + 109) - 0.5) * 2 * lean,
                    leanZ: (hash2(c.i, c.j, c.salt + 110) - 0.5) * 2 * lean,
                    hue: gold ? (clone * 0.72) + (own * 0.28) : (clone * 0.55) + (own * 0.45),
                    value: (0.35 * patchNoise(c.x, c.z, 46, 362)) + (0.65 * hash2(c.i, c.j, c.salt + 111)),
                    tint: high > 0 && !broad ? [1 - (0.06 * high), 1 - (0.02 * high), 1 + (0.10 * high)] : null,
                });
            }
        }
    });

    // ── the floor ──
    const wood = forestClosure(standing.map((p) => ({
        x: p.x, z: p.z, crownR: FOREST_SPECIMENS[p.index].reach * p.scale, speciesId: FOREST_SPECIMENS[p.index].species, role: p.role,
    })));
    const feet = createStand();
    standing.forEach((p) => {
        feet.add(p.x, p.z, Math.max(FOREST_SPECIMENS[p.index].trunkR, p.role === 'shrub' ? forestSkirt(p.index) * 0.55 : 0) * p.scale + 0.3);
    });
    // (The same sites on every tier, so a lower one plants a part of them. No rail, in a test's world: no eye,
    // and nothing so small is drawn.)
    (rail.length ? forestFloorSites(wood, eyeAt) : []).forEach((f) => {
        const index = forestSpecimenIndex(f.id);
        const spec = FOREST_SPECIMENS[index];
        const fallen = f.kind === 'log';
        const y = heightAt(f.x, f.z);
        if (onBeach(f.x, f.z, y) || siteWet(f.x, f.z) || forestTarnOpen(f.x, f.z, y)) return;
        const gx = (heightAt(f.x + 2, f.z) - heightAt(f.x - 2, f.z)) / 4;
        const gz = (heightAt(f.x, f.z + 2) - heightAt(f.x, f.z - 2)) / 4;
        const slope = Math.hypot(gx, gz);
        if (slope > (fallen ? 0.24 : 0.70)) return;
        if (!feet.fits(f.x, f.z, spec.reach * f.scale * (fallen ? 0.5 : 0.44), 1)) return;
        if (!keepouts(f.x, f.z, forestSkirt(index) * f.scale, ROCK_CLEAR_FLOOR)) return;
        if (meadowClearing && odysseyMeadowOpenness(f.x, f.z) > 0) return;
        if (visibilityCull && !railSeesForestSite(f.x, f.z)) return;
        feet.add(f.x, f.z, spec.reach * f.scale * 0.44);
        if (f.keep > keep) return;
        plant(index, f.x, f.z, y, {
            role: 'floor',
            wood: 'floor',
            dRail: railAt(f.x, f.z),
            dEye: f.dEye,
            scale: f.scale,
            scaleY: f.scale * (0.9 + (0.25 * f.tall)),
            // A fallen trunk lies along the slope, not down it.
            rot: fallen && spec.reach > 2 && slope > 0.02 ? Math.atan2(-gx, -gz) : f.rot,
            hue: f.hue,
            value: 0.30 + (0.5 * patchNoise(f.x, f.z, 17, 757)),
            fleck: f.fleck,
        });
    });

    lightGroves(placements);
    return { ...bucketForest(placements, meadowCleared), floor: bakeForestFloorData(wood) };
}

/**
 * Each near tree's light among its neighbours: `shadeTop`, the share of its height their shade reaches
 * up it, and `open`, the sky its foot sees. Far trees take their wood's own.
 */
function lightGroves(placements) {
    const len = Math.hypot(ODYSSEY_WORLD_SUN[0], ODYSSEY_WORLD_SUN[1], ODYSSEY_WORLD_SUN[2]);
    const flat = Math.hypot(ODYSSEY_WORLD_SUN[0], ODYSSEY_WORLD_SUN[2]);
    const sx = ODYSSEY_WORLD_SUN[0] / flat;
    const sz = ODYSSEY_WORLD_SUN[2] / flat;
    const tan = (ODYSSEY_WORLD_SUN[1] / len) / (flat / len);
    const cell = 14;
    const grid = new Map();
    const key = (i, j) => (i * 73856093) ^ (j * 19349663);
    placements.forEach((p, k) => {
        if (p.lod === 'far' || p.role === 'floor') return;
        const g = key(Math.floor(p.x / cell), Math.floor(p.z / cell));
        if (!grid.has(g)) grid.set(g, []);
        grid.get(g).push(k);
    });
    const each = (x, z, fn) => {
        const i0 = Math.floor(x / cell);
        const j0 = Math.floor(z / cell);
        for (let j = j0 - 1; j <= j0 + 1; j += 1) {
            for (let i = i0 - 1; i <= i0 + 1; i += 1) {
                const list = grid.get(key(i, j));
                if (list) list.forEach(fn);
            }
        }
    };
    /** How far up tree `p` the shade of tree `q` reaches, as a share of its height. */
    const shadeOf = (p, q) => {
        const rx = q.x - p.x;
        const rz = q.z - p.z;
        const along = (rx * sx) + (rz * sz);
        if (along < 0.8) return -0.5;
        const side = Math.abs((rx * sz) - (rz * sx)) / Math.max(0.5, q.crownR * 0.9);
        if (side > 1) return -0.5;
        const reach = q.y + (q.height * 0.94) - (along * tan);
        return ((reach - p.y) / p.height) - (side * side * 0.28);
    };
    placements.forEach((p, k) => {
        if (p.lod === 'far') {
            const inside = p.role === 'canopy' || p.role === 'young' ? 1 : 0.3;
            p.shadeTop = inside * 0.34;
            p.open = 1 - (inside * 0.45);
            return;
        }
        const light = { top: -0.5, crowd: 0 };
        for (let d = 0; d <= 84; d += cell) {
            each(p.x + (sx * d), p.z + (sz * d), (o) => {
                if (o !== k) light.top = Math.max(light.top, shadeOf(p, placements[o]));
            });
        }
        each(p.x, p.z, (o) => {
            if (o === k) return;
            const q = placements[o];
            const d = Math.hypot(q.x - p.x, q.z - p.z);
            light.crowd += clamp01(1 - (d / (q.crownR + p.crownR))) * Math.min(1.2, q.height / p.height);
        });
        // (Here and there a fleck of sun comes down to the floor.)
        p.shadeTop = p.fleck ? -0.5 : Math.min(0.96, light.top);
        p.open = Math.max(0.24, 1 / (1 + (0.62 * light.crowd)));
    });
}

/** A tree's draw class: trees of like size share a draw, so little of its geometry stands idle. */
function classOf(p) {
    const spec = FOREST_SPECIMENS[p.specimen];
    const { cards } = spec[p.lod === 'hero' ? 'hero' : 'mid'];
    if (spec.stage === 'fern' && p.lod !== 'far') return `floor${FLOOR_CUTS[p.lod].filter((cut) => cards > cut).length}`;
    return CLASS_CUTS[p.lod].filter((cut) => cards > cut).length;
}

function bucketForest(placements, meadowCleared) {
    const buckets = new Map();
    const bySpecies = {};
    const byLod = { hero: 0, mid: 0, far: 0 };
    const byRole = {};
    placements.forEach((p) => {
        const edge = FOREST_SPECIMENS[p.specimen].stage === 'fern' ? FOREST_CHUNK_FLOOR : FOREST_CHUNK_BY_LOD[p.lod];
        const bx = Math.floor(p.x / edge);
        const bz = Math.floor(p.z / edge);
        const key = `${p.lod}|${bx}|${bz}|${classOf(p)}`;
        if (!buckets.has(key)) {
            buckets.set(key, {
                key, lod: p.lod, edge, centre: { x: (bx + 0.5) * edge, z: (bz + 0.5) * edge }, items: [],
            });
        }
        buckets.get(key).items.push(p);
        bySpecies[p.speciesId] = (bySpecies[p.speciesId] ?? 0) + 1;
        byLod[p.lod] += 1;
        byRole[p.role] = (byRole[p.role] ?? 0) + 1;
    });
    return {
        placements,
        buckets,
        /** Sites the horses' meadow left open (x, z): not drawn; the boulders keep clear of them. */
        meadowCleared,
        stats: {
            trees: placements.length, draws: buckets.size, bySpecies, byLod, byRole,
        },
    };
}
