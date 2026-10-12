/**
 * Rainbark — the CPU bakes: the patch atlas (ragged vertical ribbons over a matrix of old bark),
 * the age ramp, the fBm bands, the noise lattice and the canopy's crowns and leaf lace. Relations,
 * not tuning numbers: the atlas is
 * deterministic, tiles on the torus, runs up the trunk, leaves the matrix its share, and its
 * channels keep the conventions the bark shader decodes.
 */
import { describe, expect, it } from 'vitest';
import {
    FBM_BANDS, bakeCrownMask, bakeFbm, bakeLattice, bakeLeafLace, bakePatchAtlas, bakeRamp, decodeEdge, planIslands,
    planRibbons,
} from '../../src/themes/rainbark/rainbark-bake.js';
import {
    ATLAS_CONSISTENT, ATLAS_ISLANDS, ATLAS_RIBBONS, BARK_TEAR, BARK_TILE, CANOPY_CROWNS, CANOPY_LACE, LATTICE_SLICE,
    PATCH_EDGE_RANGE, rampAt,
} from '../../src/themes/rainbark/rainbark-core.js';
import { MIST_POOLS } from '../../src/themes/rainbark/rainbark-tsl.js';

/** The seed the world ships (the lead's ribbon seed). */
const SEED = 21;
const atlas512 = bakePatchAtlas(SEED, 512);
const atlas256 = bakePatchAtlas(SEED, 256);

const id = (a, x, y) => a.data[(y * a.size + x) * 4];
const other = (a, x, y) => a.data[(y * a.size + x) * 4 + 2];
const edge = (a, x, y) => decodeEdge(a.data[(y * a.size + x) * 4 + 1]);
const flagged = (a, x, y) => (a.data[(y * a.size + x) * 4 + 3] & ATLAS_CONSISTENT) !== 0;
const wrap = (v, n) => ((v % n) + n) % n;

/** How often the region changes between texel x and x + 1 (wrapping), over every row. */
function changesAcross(a, x) {
    let n = 0;
    for (let y = 0; y < a.size; y++) if (id(a, x, y) !== id(a, (x + 1) % a.size, y)) n += 1;
    return n / a.size;
}

/** How often the region changes between rows y and y + 1 (wrapping), over every column. */
function changesUp(a, y) {
    let n = 0;
    for (let x = 0; x < a.size; x++) if (id(a, x, y) !== id(a, x, (y + 1) % a.size)) n += 1;
    return n / a.size;
}

describe('Rainbark bakes: the patch atlas', () => {
    it('is the same for the same seed and different for another', () => {
        const again = bakePatchAtlas(SEED, 256);
        expect(again.data).toEqual(atlas256.data);
        expect(again.matrixShare).toBe(atlas256.matrixShare);
        const otherSeed = bakePatchAtlas(SEED + 1, 256);
        expect(otherSeed.data).not.toEqual(atlas256.data);
        expect(planRibbons(SEED, 18)).toEqual(planRibbons(SEED, 18));
        expect(planIslands(SEED, 8)).toEqual(planIslands(SEED, 8));
    });

    it('lays its ribbons over a matrix of old bark that keeps 35–48 % of the tile, at every size', () => {
        for (const a of [atlas512, atlas256]) {
            expect(a.count).toBe(ATLAS_RIBBONS);
            expect(a.count).toBeGreaterThanOrEqual(16);
            expect(a.count).toBeLessThanOrEqual(22);
            expect(a.islands).toBe(ATLAS_ISLANDS);
            expect(a.matrixShare).toBeGreaterThan(0.35);
            expect(a.matrixShare).toBeLessThan(0.48);
        }
        // The lowest tier's atlas tears along the same edges: the same share of matrix.
        expect(atlas256.matrixShare).toBeCloseTo(atlas512.matrixShare, 2);
    });

    it('scatters a few pale old-skin islands through the matrix, under every ribbon', () => {
        for (const a of [atlas512, atlas256]) {
            // About a tenth of the matrix, and most islands show somewhere (ribbons hide some).
            const ofMatrix = a.islandShare / a.matrixShare;
            expect(ofMatrix).toBeGreaterThan(0.06);
            expect(ofMatrix).toBeLessThan(0.18);
            const seen = new Set();
            for (let i = 0; i < a.size * a.size; i++) seen.add(a.data[i * 4]);
            let shown = 0;
            for (let k = 1; k <= ATLAS_ISLANDS; k++) if (seen.has(k)) shown += 1;
            expect(shown).toBeGreaterThanOrEqual(ATLAS_ISLANDS / 2);
            // Ribbons are laid over them: no ribbon ever borders an island from below.
            let under = 0;
            for (let y = 0; y < a.size; y += 2) {
                for (let x = 0; x < a.size; x += 2) {
                    const r = id(a, x, y);
                    const b = other(a, x, y);
                    if (r > ATLAS_ISLANDS && b >= 1 && b <= ATLAS_ISLANDS && edge(a, x, y) < 0) under += 1;
                }
            }
            expect(under).toBe(0);
        }
        // Islands are smaller lozenges than the ribbons; some ribbons and islands end in a point.
        const islands = planIslands(SEED, ATLAS_ISLANDS);
        const ribbons = planRibbons(SEED, ATLAS_RIBBONS);
        const mean = (list, key) => list.reduce((sum, r) => sum + r[key], 0) / list.length;
        expect(mean(islands, 'h')).toBeLessThan(mean(ribbons, 'h'));
        expect(mean(islands, 'w0')).toBeLessThan(1);
        expect(ribbons.some((r) => r.pointed)).toBe(true);
        expect(ribbons.some((r) => !r.pointed)).toBe(true);
        expect(Math.min(...ribbons.map((r) => r.breathLo))).toBeLessThan(0.5);
    });

    it('tiles on the torus: no seam where it wraps round or up', () => {
        for (const a of [atlas512, atlas256]) {
            let across = 0;
            for (let x = 0; x < a.size - 1; x++) across += changesAcross(a, x);
            across /= a.size - 1;
            let up = 0;
            for (let y = 0; y < a.size - 1; y++) up += changesUp(a, y);
            up /= a.size - 1;
            // The wrapping column pair and row pair change no more often than a typical one.
            expect(changesAcross(a, a.size - 1)).toBeLessThan(across * 3 + 0.02);
            expect(changesUp(a, a.size - 1)).toBeLessThan(up * 3 + 0.02);
            // And the edge distance runs on smoothly over the seam.
            let jump = 0;
            let inner = 0;
            for (let y = 0; y < a.size; y++) {
                jump += Math.abs(edge(a, a.size - 1, y) - edge(a, 0, y));
                inner += Math.abs(edge(a, a.size / 2 - 1, y) - edge(a, a.size / 2, y));
            }
            expect(jump / a.size).toBeLessThan((inner / a.size) * 3 + 0.005);
        }
    });

    it('runs up the trunk: edges cross a metre round it at least four times as often as a metre up it', () => {
        for (const a of [atlas512, atlas256]) {
            let across = 0;
            for (let x = 0; x < a.size; x++) across += changesAcross(a, x);
            let up = 0;
            for (let y = 0; y < a.size; y++) up += changesUp(a, y);
            const perMetreAround = across / BARK_TILE.around;
            const perMetreUp = up / BARK_TILE.up;
            expect(perMetreAround / perMetreUp).toBeGreaterThan(4);
        }
    });

    it('keeps the conventions the bark shader decodes', () => {
        const a = atlas512;
        let positive = 0;
        let pairs = 0;
        let bad = 0;
        const regions = a.count + a.islands;
        for (let y = 0; y < a.size; y += 3) {
            for (let x = 0; x < a.size; x += 3) {
                const r = id(a, x, y);
                const b = other(a, x, y);
                const code = a.data[(y * a.size + x) * 4 + 3] & (ATLAS_CONSISTENT - 1);
                const phi = edge(a, x, y);
                // Ids within the regions laid, two wrap codes (base-3 digit pairs), a bounded edge.
                if (r > regions || b > regions || code >= 81 || Math.abs(phi) > PATCH_EDGE_RANGE + 1e-9) bad += 1;
                if (r !== b) {
                    // Positive inside the higher id of the pair, on both sides of every edge.
                    pairs += 1;
                    if ((phi >= 0) === (r > b)) positive += 1;
                }
            }
        }
        expect(bad).toBe(0);
        expect(pairs).toBeGreaterThan(1000);
        // Rounding to a byte can only blur a texel that sits on its edge.
        expect(positive / pairs).toBeGreaterThan(0.995);
    });

    it('names, across a near edge, the region that really shows there (never one hidden under it)', () => {
        for (const a of [atlas512, atlas256]) {
            const tw = BARK_TILE.around / a.size;
            const th = BARK_TILE.up / a.size;
            const reach = 2 * Math.hypot(tw, th) + BARK_TEAR;
            const rx = Math.ceil(reach / tw) + 1;
            const ry = Math.ceil(reach / th) + 1;
            let near = 0;
            let found = 0;
            for (let y = 0; y < a.size; y += 2) {
                for (let x = 0; x < a.size; x += 2) {
                    const r = id(a, x, y);
                    const b = other(a, x, y);
                    if (r === b || Math.abs(edge(a, x, y)) >= reach) continue;
                    near += 1;
                    let ok = false;
                    for (let oy = -ry; oy <= ry && !ok; oy++) {
                        for (let ox = -rx; ox <= rx && !ok; ox++) {
                            if (id(a, wrap(x + ox, a.size), wrap(y + oy, a.size)) === b) ok = true;
                        }
                    }
                    if (ok) found += 1;
                }
            }
            expect(near).toBeGreaterThan(5000 / (512 / a.size) ** 2);
            expect(found / near).toBeGreaterThan(0.995);
        }
    });

    it('marks the texels whose neighbours agree on their edge, which is nearly every texel near one', () => {
        for (const a of [atlas512, atlas256]) {
            const tw = BARK_TILE.around / a.size;
            const th = BARK_TILE.up / a.size;
            const tau = Math.hypot(tw, th) + BARK_TEAR;
            let near = 0;
            let marked = 0;
            let wrong = 0;
            for (let y = 0; y < a.size; y++) {
                for (let x = 0; x < a.size; x++) {
                    const r = id(a, x, y);
                    const b = other(a, x, y);
                    const isNear = Math.abs(edge(a, x, y)) < tau;
                    if (isNear) near += 1;
                    if (!flagged(a, x, y)) continue;
                    if (isNear) marked += 1;
                    // A marked texel's neighbours each show one of its pair.
                    for (let oy = -1; oy <= 1; oy++) {
                        for (let ox = -1; ox <= 1; ox++) {
                            const n = id(a, wrap(x + ox, a.size), wrap(y + oy, a.size));
                            if (n !== r && n !== b) wrong += 1;
                        }
                    }
                }
            }
            expect(wrong).toBe(0);
            // Only junctions and the thinnest slivers are left to the nearest texel.
            expect(marked / near).toBeGreaterThan(0.88);
        }
    });

    it('leaves no sliver one or two texels wide round the trunk (it could only twinkle)', () => {
        for (const a of [atlas512, atlas256]) {
            let slivers = 0;
            for (let y = 0; y < a.size; y++) {
                for (let x = 0; x < a.size; x++) {
                    const l = id(a, wrap(x - 1, a.size), y);
                    const r = id(a, x, y);
                    if (r === l) continue;
                    if (id(a, wrap(x + 1, a.size), y) === l) slivers += 1;
                    else if (id(a, wrap(x + 1, a.size), y) === r && id(a, wrap(x + 2, a.size), y) === l) slivers += 1;
                }
            }
            expect(slivers).toBe(0);
        }
    });

    it('cuts each edge between the two texels that straddle it', () => {
        // Neighbours round the trunk that show different regions of the same pair have edge
        // distances of opposite signs, so a linear read crosses zero between them.
        const a = atlas512;
        let straddles = 0;
        let crossings = 0;
        // (Both texels name each other's region across the edge.)
        for (let y = 0; y < a.size; y += 2) {
            for (let x = 0; x < a.size - 1; x++) {
                const r0 = id(a, x, y);
                const r1 = id(a, x + 1, y);
                if (r0 === r1 || other(a, x, y) !== r1 || other(a, x + 1, y) !== r0) continue;
                straddles += 1;
                if (edge(a, x, y) * edge(a, x + 1, y) <= 0) crossings += 1;
            }
        }
        expect(straddles).toBeGreaterThan(500);
        expect(crossings / straddles).toBeGreaterThan(0.98);
    });
});

describe('Rainbark bakes: the ramp, the fBm bands and the lattice', () => {
    it('bakes the age ramp in linear light, end to end', () => {
        const ramp = bakeRamp();
        expect(ramp.width).toBe(256);
        expect(ramp.height).toBe(1);
        expect(ramp.data).toHaveLength(256 * 4);
        for (const [i, age] of [[0, 0], [255, 1], [128, 128 / 255]]) {
            const want = rampAt(age);
            for (let c = 0; c < 3; c++) expect(Math.abs(ramp.data[i * 4 + c] - want[c] * 255)).toBeLessThanOrEqual(0.5);
            expect(ramp.data[i * 4 + 3]).toBe(255);
        }
    });

    it('bakes four tileable bands at full range, with every mip down to one texel', () => {
        const fbm = bakeFbm(4441, 64);
        expect(fbm.data).toEqual(bakeFbm(4441, 64).data);
        expect(fbm.mipmaps).toHaveLength(7);
        expect(fbm.mipmaps[0].data).toBe(fbm.data);
        expect(fbm.mipmaps[6].width).toBe(1);
        const size = 64;
        FBM_BANDS.forEach((_, band) => {
            let lo = 255;
            let hi = 0;
            let seam = 0;
            let inner = 0;
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    const v = fbm.data[(y * size + x) * 4 + band];
                    lo = Math.min(lo, v);
                    hi = Math.max(hi, v);
                }
                const at = (x) => fbm.data[(y * size + x) * 4 + band];
                seam += Math.abs(at(size - 1) - at(0));
                inner += Math.abs(at(size / 2 - 1) - at(size / 2));
            }
            expect(lo).toBe(0);
            expect(hi).toBe(255);
            expect(seam).toBeLessThan(inner * 3 + size);
        });
    });

    it('bakes the lattice with each second field one z-slice along', () => {
        const size = 32;
        const lattice = bakeLattice(9917, size);
        const at = (x, y, c) => lattice.data[(y * size + x) * 4 + c];
        for (const [x, y] of [[0, 0], [5, 9], [31, 31]]) {
            const sx = (x + LATTICE_SLICE[0]) % size;
            const sy = (y + LATTICE_SLICE[1]) % size;
            expect(at(x, y, 1)).toBe(at(sx, sy, 0));
            expect(at(x, y, 3)).toBe(at(sx, sy, 2));
        }
    });
});

describe('Rainbark bakes: the mist\'s sun pools', () => {
    it('melt far off into the very mean of their cut fBm band (the near and far mist agree)', () => {
        const fbm = bakeFbm(4441);
        const level = fbm.mipmaps[MIST_POOLS.level];
        const [lo, hi] = MIST_POOLS.cut;
        const cut = (x) => {
            const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
            return t * t * (3 - 2 * t);
        };
        let sum = 0;
        const n = level.width * level.height;
        for (let i = 0; i < n; i++) sum += cut(level.data[i * 4] / 255);
        expect(Math.abs(sum / n - MIST_POOLS.mean)).toBeLessThan(0.03);
        expect(MIST_POOLS.fade[1]).toBeGreaterThan(MIST_POOLS.fade[0]);
    });
});

describe('Rainbark bakes: the canopy\'s leaf lace', () => {
    const lace = bakeLeafLace();

    it('is one R8 tile with its mip chain down to a texel, the same for the same seed', () => {
        expect(lace.data).toBeInstanceOf(Uint8Array);
        expect(lace.data.length).toBe(lace.size * lace.size);
        expect(lace.mipmaps).toHaveLength(Math.log2(lace.size) + 1);
        expect(lace.mipmaps[0].data).toBe(lace.data);
        expect(lace.mipmaps[lace.mipmaps.length - 1].width).toBe(1);
        // The last mip is the tile's mean coverage.
        expect(lace.mipmaps[lace.mipmaps.length - 1].data[0] / 255).toBeCloseTo(lace.cover, 1);
        const again = bakeLeafLace();
        expect(again.data.every((v, i) => v === lace.data[i])).toBe(true);
        const reseeded = bakeLeafLace(CANOPY_LACE.seed + 1);
        expect(reseeded.data.some((v, i) => v !== lace.data[i])).toBe(true);
    });

    it('is mostly leaves with sky between them, and both: solid clumps, open gaps and soft leaf edges', () => {
        expect(lace.cover).toBeGreaterThan(0.5);
        expect(lace.cover).toBeLessThan(0.95);
        let solid = 0;
        let open = 0;
        let soft = 0;
        lace.data.forEach((v) => {
            if (v === 255) solid += 1;
            else if (v === 0) open += 1;
            else soft += 1;
        });
        const n = lace.data.length;
        expect(solid / n).toBeGreaterThan(0.2);
        expect(open / n).toBeGreaterThan(0.03);
        expect(soft / n).toBeGreaterThan(0.02);
    });

    it('bakes in a few tens of milliseconds, never stalling the theme\'s build (a generous guard)', () => {
        const t0 = performance.now();
        bakeLeafLace();
        expect(performance.now() - t0).toBeLessThan(120);
        const t1 = performance.now();
        bakeCrownMask();
        expect(performance.now() - t1).toBeLessThan(120);
    });

    it('tiles: across its seams the coverage changes no more than between any two neighbouring texels', () => {
        const S = lace.size;
        const at = (x, y) => lace.data[(((y % S) + S) % S) * S + (((x % S) + S) % S)];
        const step = (x0, y0, dx, dy) => {
            let sum = 0;
            for (let i = 0; i < S; i++) {
                const x = dx ? x0 : i;
                const y = dy ? y0 : i;
                sum += Math.abs(at(x, y) - at(x + dx, y + dy));
            }
            return sum / S;
        };
        let inner = 0;
        for (let k = 1; k < S - 1; k += 37) inner = Math.max(inner, step(k, 0, 1, 0), step(0, k, 0, 1));
        expect(step(S - 1, 0, 1, 0)).toBeLessThanOrEqual(inner * 1.5);
        expect(step(0, S - 1, 0, 1)).toBeLessThanOrEqual(inner * 1.5);
    });
});

describe('Rainbark bakes: the canopy\'s crowns', () => {
    const crowns = bakeCrownMask();
    const S = crowns.size;
    const at = (x, y) => crowns.data[(((y % S) + S) % S) * S + (((x % S) + S) % S)] / 255;

    it('is one R8 tile with its mip chain, the same for the same seed', () => {
        expect(crowns.data).toBeInstanceOf(Uint8Array);
        expect(crowns.data.length).toBe(S * S);
        expect(S).toBe(CANOPY_CROWNS.size);
        expect(crowns.mipmaps).toHaveLength(Math.log2(S) + 1);
        expect(crowns.mipmaps[crowns.mipmaps.length - 1].data[0] / 255).toBeCloseTo(crowns.cover, 1);
        expect(bakeCrownMask().data.every((v, i) => v === crowns.data[i])).toBe(true);
        expect(bakeCrownMask(CANOPY_CROWNS.seed + 1).data.some((v, i) => v !== crowns.data[i])).toBe(true);
    });

    it('is mostly crown, with channels of shyness a few metres wide and a few big holes', () => {
        expect(crowns.cover).toBeGreaterThan(0.6);
        expect(crowns.cover).toBeLessThan(0.9);
        // Runs of sky across each row (metres): most are channels of 1–4 m, a few holes are wider.
        const metres = CANOPY_CROWNS.tile / S;
        const runs = [];
        for (let y = 0; y < S; y += 4) {
            let run = 0;
            for (let x = 0; x < 2 * S; x++) {
                if (at(x, y) < 0.5) run += 1;
                else if (run) {
                    if (x > S) runs.push(run * metres);
                    run = 0;
                }
            }
        }
        runs.sort((a, b) => a - b);
        const median = runs[Math.floor(runs.length / 2)];
        expect(median).toBeGreaterThan(1);
        expect(median).toBeLessThan(5);
        expect(runs[runs.length - 1]).toBeGreaterThan(8);
    });

    it('tiles: no seam where it wraps', () => {
        let seam = 0;
        let inner = 0;
        for (let i = 0; i < S; i++) {
            seam = Math.max(seam, Math.abs(at(S - 1, i) - at(S, i)), Math.abs(at(i, S - 1) - at(i, S)));
            const h = S / 2;
            inner = Math.max(inner, Math.abs(at(h, i) - at(h + 1, i)), Math.abs(at(i, h) - at(i, h + 1)));
        }
        expect(seam).toBeLessThanOrEqual(inner * 1.5 + 0.02);
    });
});
