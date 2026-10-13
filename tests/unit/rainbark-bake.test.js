/**
 * Rainbark — the CPU bakes: the patch atlas (ragged vertical ribbons over a matrix of old bark),
 * the age ramp, the fBm bands, the noise lattice and the canopy's crowns and leaf lace. Relations,
 * not tuning numbers: the atlas is
 * deterministic, tiles on the torus, runs up the trunk, leaves the matrix its share, and its
 * channels keep the conventions the bark shader decodes.
 */
import { describe, expect, it } from 'vitest';
import {
    ATLAS_PHASES_21, ATLAS_PHASE_SIZE, FBM_BANDS, atlasPhases, bakeCrownField, bakeFbm, bakeGapMask, bakeLattice,
    bakeLeafLace, bakePatchAtlas, bakeRamp, decodeEdge,
    planIslands, planRibbons,
} from '../../src/themes/rainbark/rainbark-bake.js';
import {
    ATLAS_CONSISTENT, ATLAS_ISLANDS, ATLAS_RIBBONS, BARK_TEAR, BARK_TILE, CANOPY_CROWNS, CANOPY_LACE, GAP_MASK,
    LATTICE_SLICE, PATCH_EDGE_RANGE, ageOfPhase, barkAlbedo, rampAt, ribbonPhases, vividShare, warpAge,
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
        // The width breathes only gently (no bottle-shaped bellies: at most about 1.6 times its
        // narrowest) and changes in torn jogs.
        ribbons.forEach((r) => {
            expect(r.breathHi / r.breathLo).toBeLessThanOrEqual(1.6);
            expect(r.breathHi).toBeLessThanOrEqual(1.2);
            expect(r.jogs.length).toBeGreaterThanOrEqual(1);
            expect(r.jogs.length).toBeLessThanOrEqual(3);
            r.jogs.forEach((g) => {
                expect(Math.abs(g.step)).toBeGreaterThanOrEqual(0.04);
                expect(Math.abs(g.step)).toBeLessThanOrEqual(0.12);
                expect(Math.abs(g.y)).toBeLessThan(r.h / 2);
            });
        });
    });

    it('places each ribbon in its cycle the same on every tier (one coarse bake per seed, kept)', () => {
        // A ribbon must show the same colour at the same moment on Minimal and on High.
        expect(atlas256.phases).toBe(atlas512.phases);
        expect(atlasPhases(SEED)).toBe(atlas512.phases);
        const coarse = bakePatchAtlas(SEED, ATLAS_PHASE_SIZE, { phases: false });
        expect(coarse.phases).toBeNull();
        // Its areas are the plan's: within a few per cent of a fine bake's, ribbon by ribbon.
        const share = (a, k) => a.areas[k] / (a.size * a.size);
        let worst = 0;
        for (let k = 0; k < ATLAS_RIBBONS; k++) {
            worst = Math.max(worst, Math.abs(share(coarse, k) - share(atlas512, k)));
        }
        expect(worst).toBeLessThan(0.01);
        // Another seed has its own.
        expect(atlasPhases(SEED + 1)).not.toEqual(atlas512.phases);
    });

    it('keeps the world\'s ribbon places frozen exactly as the search finds them (no search at load)', () => {
        const found = atlasPhases(21, ATLAS_RIBBONS, ATLAS_ISLANDS, { search: true });
        expect(found).toHaveLength(ATLAS_PHASES_21.length);
        expect(Array.from(found)).toEqual(Array.from(Float32Array.from(ATLAS_PHASES_21)));
        expect(Array.from(atlasPhases(21))).toEqual(Array.from(found));
    });

    it('spreads its ribbons round their tile\'s cycle by area: the vivid share of a tile holds steady', () => {
        const a = atlas512;
        expect(a.areas).toHaveLength(ATLAS_RIBBONS);
        expect(a.phases).toHaveLength(ATLAS_RIBBONS);
        a.phases.forEach((p) => {
            expect(p).toBeGreaterThanOrEqual(0);
            expect(p).toBeLessThan(1);
        });
        // The ribbons' areas add up to what the matrix leaves.
        const ribbonTexels = a.areas.reduce((sum, x) => sum + x, 0);
        expect(ribbonTexels / (a.size * a.size)).toBeCloseTo(1 - a.matrixShare, 2);
        // A ribbon is vivid where its bark keeps a jewel's chroma (CIELAB C* > 25).
        const lab = (rgb) => {
            const M = [[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]];
            const w = [0.95047, 1, 1.08883];
            const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
            const xyz = M.map((row, i) => f((row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]) / w[i]));
            return { a: 500 * (xyz[0] - xyz[1]), b: 200 * (xyz[1] - xyz[2]) };
        };
        const vivid = (age) => {
            const { a: aa, b } = lab(barkAlbedo(age));
            return Math.hypot(aa, b) > 25;
        };
        // Fifty moments round a tile's cycle, at the grove's resting bias: the vivid share of the
        // tile (by area) holds within a narrow band (A1 review: 0.43–0.50 swings came from big
        // ribbons young together); its floor is the largest ribbon's own area (8 % of a tile).
        const shares = [];
        for (let i = 0; i < 50; i++) {
            const turn = (i + 0.31) / 50;
            let lit = 0;
            for (let k = 0; k < ATLAS_RIBBONS; k++) {
                const age = ageOfPhase(warpAge((a.phases[k] + turn) % 1, 0.4));
                if (vivid(age)) lit += a.areas[k];
            }
            shares.push(lit / (a.size * a.size));
        }
        expect(Math.min(...shares)).toBeGreaterThanOrEqual(0.33);
        expect(Math.max(...shares)).toBeLessThanOrEqual(0.47);
        expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(0.11);
        // Spread by count (the A1 places), the same atlas swings further.
        const even = Float32Array.from(
            { length: ATLAS_RIBBONS },
            (_, k) => (((k * 7) % ATLAS_RIBBONS) + 0.5) / ATLAS_RIBBONS,
        );
        const evenShares = Array.from({ length: 50 }, (_, i) => vividShare(even, a.areas, (i + 0.31) / 50));
        const byArea = Array.from({ length: 50 }, (_, i) => vividShare(a.phases, a.areas, (i + 0.31) / 50));
        const swing = (list) => Math.max(...list) - Math.min(...list);
        expect(swing(byArea)).toBeLessThan(swing(evenShares));
        // Equal ribbons stand evenly round the cycle, each at the middle of its share.
        const four = Array.from(ribbonPhases([1, 1, 1, 1])).sort();
        four.forEach((p, i) => expect(p).toBeCloseTo((i + 0.5) / 4, 6));
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
    it('melt far off into the very mean of their cut of the canopy\'s gap mask (the near and far mist agree)', () => {
        const level = bakeGapMask().mipmaps[MIST_POOLS.level];
        const [lo, hi] = MIST_POOLS.cut;
        const cut = (x) => {
            const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
            return t * t * (3 - 2 * t);
        };
        let sum = 0;
        const n = level.width * level.height;
        for (let i = 0; i < n; i++) sum += cut(level.data[i] / 255);
        expect(Math.abs(sum / n - MIST_POOLS.mean)).toBeLessThan(0.03);
        expect(MIST_POOLS.fade[1]).toBeGreaterThan(MIST_POOLS.fade[0]);
    });
});

describe('Rainbark bakes: the canopy\'s gap mask (the sunflecks\' gobo)', () => {
    const mask = bakeGapMask();

    it('is one R8 tile with its pyramid down to a texel, the same for the same seed', () => {
        expect(mask.size).toBe(GAP_MASK.size);
        expect(mask.data).toHaveLength(GAP_MASK.size * GAP_MASK.size);
        // (Every level, the first too, is stored softened: GAP_MASK.oversample.)
        expect(mask.mipmaps[0].data).toHaveLength(mask.data.length);
        expect(mask.mipmaps).toHaveLength(Math.log2(GAP_MASK.size) + 1);
        mask.mipmaps.forEach((level, i) => {
            expect(level.width).toBe(GAP_MASK.size >> i);
            expect(level.data).toHaveLength(level.width * level.height);
        });
        expect(bakeGapMask().data).toEqual(mask.data);
        expect(bakeGapMask(GAP_MASK.seed + 1).data).not.toEqual(mask.data);
    });

    it('is mostly leaves, with openings of every size gathered in clumps', () => {
        const G = GAP_MASK;
        expect(mask.openings.length).toBeGreaterThanOrEqual(G.patches * G.pinholes[0] + G.mediums + G.fine);
        expect(mask.openings.length).toBeLessThanOrEqual(G.patches * G.pinholes[1] + G.mediums + G.fine);
        expect(mask.open).toBeGreaterThan(0.08);
        expect(mask.open).toBeLessThan(0.3);
        const radii = mask.openings.map((o) => o.r);
        expect(Math.min(...radii)).toBeLessThan(G.fineR[1]);
        expect(Math.max(...radii)).toBeGreaterThan(G.medium[0]);
        // The patches' pinholes gather: each has a neighbour much nearer than the scattered ones do.
        const near = (o) => Math.min(...mask.openings.filter((q) => q !== o).map((q) => {
            const dx = Math.min(Math.abs(o.x - q.x), G.tile - Math.abs(o.x - q.x));
            const dy = Math.min(Math.abs(o.y - q.y), G.tile - Math.abs(o.y - q.y));
            return Math.hypot(dx, dy);
        }));
        const patchNear = mask.openings.slice(0, 40).map(near).reduce((a, b) => a + b, 0) / 40;
        expect(patchNear).toBeLessThan(0.35);
        // Every texel is open, closed or an anti-aliased rim.
        let rim = 0;
        for (let i = 0; i < mask.data.length; i++) if (mask.data[i] > 0 && mask.data[i] < 255) rim += 1;
        expect(rim).toBeGreaterThan(0);
        // (Hundreds of pinholes: their anti-aliased rims are a larger share than a few big gaps'.)
        expect(rim / mask.data.length).toBeLessThan(0.15);
    });

    it('keeps its light through the pyramid (each level holds the mean of the last), round and soft', () => {
        const mean = (level) => level.data.reduce((sum, v) => sum + v, 0) / level.data.length;
        const base = mean(mask.mipmaps[0]);
        for (let i = 1; i < 7; i++) expect(Math.abs(mean(mask.mipmaps[i]) - base)).toBeLessThan(2.5);
        // Band-limited: a level never jumps from a bright texel to an empty neighbour (a box chain
        // turns a lone opening into one bright texel, which a bilinear read draws as a diamond).
        const level = mask.mipmaps[4];
        const w = level.width;
        let worst = 0;
        let peak = 0;
        for (let y = 0; y < w; y++) {
            for (let x = 0; x < w; x++) {
                const v = level.data[y * w + x];
                peak = Math.max(peak, v);
                worst = Math.max(worst, Math.abs(v - level.data[y * w + ((x + 1) % w)]));
            }
        }
        // (A box chain's lone opening jumps by the whole peak; a dense field's crowded patches may
        // step by a little over half of it.)
        expect(worst).toBeLessThan(peak * 0.65);
        // Oversampled: every level, the first included, keeps the field's light and steps by under
        // a fifth of its peak between texels (a bump spans enough of them that a bilinear read cut
        // at a threshold draws a round disc, never a polygon).
        expect(Math.abs(mean(mask.mipmaps[0]) - mask.data.reduce((sum, v) => sum + v, 0) / mask.data.length))
            .toBeLessThan(0.5);
        for (let i = 0; i < 5; i++) {
            const lv = mask.mipmaps[i];
            let top = 0;
            let step = 0;
            for (let k = 0; k < lv.data.length; k++) {
                top = Math.max(top, lv.data[k]);
                step = Math.max(step, Math.abs(lv.data[k] - lv.data[k - (k % lv.width) + ((k + 1) % lv.width)]));
            }
            expect(step, `level ${i}`).toBeLessThan(top * 0.2);
        }
    });

    it('tiles: no seam where it wraps', () => {
        const at = (x, y) => mask.data[y * mask.size + x];
        let seam = 0;
        let inner = 0;
        for (let y = 0; y < mask.size; y++) {
            seam += Math.abs(at(mask.size - 1, y) - at(0, y));
            inner += Math.abs(at(mask.size / 2 - 1, y) - at(mask.size / 2, y));
        }
        expect(seam).toBeLessThan(inner * 3 + 255 * 4);
    });

    it('bakes in a few tens of milliseconds (a generous guard)', () => {
        const t0 = performance.now();
        bakeGapMask(GAP_MASK.seed + 7);
        expect(performance.now() - t0).toBeLessThan(250);
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
        // (The crown field's signed distances and half-widths take more: still once per page.)
        const t1 = performance.now();
        bakeCrownField();
        expect(performance.now() - t1).toBeLessThan(400);
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
    const crowns = bakeCrownField();
    const S = crowns.size;
    const R = CANOPY_CROWNS.range;
    const metre = CANOPY_CROWNS.tile / S;
    const ch = (x, y, c) => crowns.data[((((y % S) + S) % S) * S + (((x % S) + S) % S)) * 4 + c];
    /** The signed distance to the leaves' edge (metres, + in the leaves). */
    const at = (x, y) => (ch(x, y, 0) / 255 - 0.5) * 2 * R;
    const limbAt = (x, y) => ch(x, y, 1) / 255;
    const widthAt = (x, y) => (ch(x, y, 2) / 255) * R;

    it('is one RGBA8 tile (field, limbs, half-widths, tones) with its mip chain, the same for the same seed', () => {
        expect(crowns.data).toBeInstanceOf(Uint8Array);
        expect(crowns.channels).toBe(4);
        expect(crowns.data.length).toBe(S * S * 4);
        expect(S).toBe(CANOPY_CROWNS.size);
        expect(crowns.mipmaps).toHaveLength(Math.log2(S) + 1);
        expect(bakeCrownField().data.every((v, i) => v === crowns.data[i])).toBe(true);
        expect(bakeCrownField(CANOPY_CROWNS.seed + 1).data.some((v, i) => v !== crowns.data[i])).toBe(true);
    });

    it('is a distance field: crisp at any threshold, its slope a metre a metre (never a blurred noise)', () => {
        let steep = 0;
        let n = 0;
        for (let y = 0; y < S; y++) {
            for (let x = 0; x < S; x++) {
                if (Math.abs(at(x, y)) > R - 0.1) continue;
                n += 1;
                const g = Math.max(Math.abs(at(x + 1, y) - at(x, y)), Math.abs(at(x, y + 1) - at(x, y)));
                if (g > metre * 1.6) steep += 1;
            }
        }
        expect(steep / n).toBeLessThan(0.1);
        // Deep in a mass it reads as deep (a crease between clumps is no edge): some leaves stand a
        // metre and more from any opening, and open sky stands that far from any leaf.
        let deepLeaf = 0;
        let openSky = 0;
        for (let i = 0; i < S * S; i++) {
            const d = (crowns.data[i * 4] / 255 - 0.5) * 2 * R;
            if (d > 1) deepLeaf += 1;
            if (d < -1) openSky += 1;
        }
        expect(deepLeaf / (S * S)).toBeGreaterThan(0.05);
        expect(openSky / (S * S)).toBeGreaterThan(0.03);
    });

    it('holds every opening\'s half-width: at least the texel\'s own distance to the leaves', () => {
        let ok = 0;
        let n = 0;
        let wider = 0;
        for (let y = 0; y < S; y += 2) {
            for (let x = 0; x < S; x += 2) {
                const d = at(x, y);
                if (d >= -0.05) continue;
                n += 1;
                if (widthAt(x, y) >= -d - metre) ok += 1;
                if (widthAt(x, y) > -d + 0.3) wider += 1;
            }
        }
        expect(ok / n).toBeGreaterThan(0.99);
        // (Near an opening's edge the half-width is the opening's, wider than the texel's own.)
        expect(wider / n).toBeGreaterThan(0.1);
    });

    it('holds the crowns\' limbs: thin dark lines from each crown\'s heart, most of them under leaves', () => {
        let limbs = 0;
        let inCrown = 0;
        for (let y = 0; y < S; y++) {
            for (let x = 0; x < S; x++) {
                if (limbAt(x, y) > 0.5) {
                    limbs += 1;
                    if (at(x, y) > 0) inCrown += 1;
                }
            }
        }
        // A few per cent of the tile, mostly under leaves (seen only where they part).
        expect(limbs / (S * S)).toBeGreaterThan(0.01);
        expect(limbs / (S * S)).toBeLessThan(0.12);
        expect(inCrown / limbs).toBeGreaterThan(0.6);
        // Thin lines, not blots (5 × 5 texels round a limb texel all limb only where limbs meet).
        let solid = 0;
        for (let y = 0; y < S; y++) {
            for (let x = 0; x < S; x++) {
                if (limbAt(x, y) <= 0.5) continue;
                let all = true;
                for (let dy = -2; dy <= 2 && all; dy++) {
                    for (let dx = -2; dx <= 2 && all; dx++) all = limbAt(x + dx, y + dy) > 0.5;
                }
                if (all) solid += 1;
            }
        }
        expect(solid / limbs).toBeLessThan(0.05);
    });

    it('is mostly leaves, with channels of shyness a few metres wide between the crowns and a few big holes', () => {
        expect(crowns.cover).toBeGreaterThan(0.45);
        expect(crowns.cover).toBeLessThan(0.8);
        // Runs of sky across each row wider than a pinhole (metres): most are a metre to a few,
        // a few holes and channels run far wider.
        const runs = [];
        for (let y = 0; y < S; y += 4) {
            let run = 0;
            for (let x = 0; x < 2 * S; x++) {
                if (at(x, y) <= 0) run += 1;
                else if (run) {
                    if (x > S && run * metre > 0.6) runs.push(run * metre);
                    run = 0;
                }
            }
        }
        runs.sort((a, b) => a - b);
        const median = runs[Math.floor(runs.length / 2)];
        expect(median).toBeGreaterThan(0.8);
        expect(median).toBeLessThan(5);
        expect(runs[runs.length - 1]).toBeGreaterThan(8);
    });

    it('lights its masses by their clumps: each leaf texel carries a tone, varying across the tile', () => {
        let lo = 255;
        let hi = 0;
        for (let i = 0; i < S * S; i++) {
            if (crowns.data[i * 4] <= 128) continue;
            lo = Math.min(lo, crowns.data[i * 4 + 3]);
            hi = Math.max(hi, crowns.data[i * 4 + 3]);
        }
        expect(hi - lo).toBeGreaterThan(120);
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
