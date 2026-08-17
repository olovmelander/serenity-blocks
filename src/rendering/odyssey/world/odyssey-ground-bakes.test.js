import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';

import {
    GROUND_BAKE_EXTENT, bakeGroundAtlas, bakeGroundSunFields,
} from './odyssey-ground-bakes.js';
import {
    ODYSSEY_GROUND_DRYNESS,
    ODYSSEY_GROUND_PALETTE,
    ODYSSEY_GROUND_SHADE,
    ODYSSEY_GROUND_STRATA,
    groundPaletteLuma,
    groundPaletteSaturation,
} from './odyssey-ground-palette.js';
import { ODYSSEY_SEA_LEVEL, odysseyWorldHeight } from './odyssey-world-height.js';
import { ODYSSEY_WORLD_SUN } from '../chapter-environments/shared/chapter-profile.js';

/**
 * GROUND PLAN — the bakes and the palette, guarded where they can lie silently.
 *
 * Both of the defects these tests exist for were found by PROBING a bake, not by reading it:
 * a field that computed correctly and came out flat, and an anisotropic tile that had to be
 * checked per-axis before its seam could be judged. Neither would have failed a build, and
 * neither is visible in a screenshot until it is too late to attribute.
 */

const RES = 192;
/** A cheap bilinear mirror of the drawn height, standing in for `relief.sample`. */
function heightMirror(res = 256) {
    const step = GROUND_BAKE_EXTENT / (res - 1);
    const origin = -GROUND_BAKE_EXTENT / 2;
    const tot = new Float32Array(res * res);
    for (let j = 0; j < res; j += 1) {
        const z = origin + (j * step);
        for (let i = 0; i < res; i += 1) tot[(j * res) + i] = odysseyWorldHeight(origin + (i * step), z);
    }
    return (x, z) => {
        const gx = Math.max(0, Math.min(res - 1.001, (x - origin) / step));
        const gz = Math.max(0, Math.min(res - 1.001, (z - origin) / step));
        const i0 = Math.floor(gx); const j0 = Math.floor(gz);
        const fx = gx - i0; const fz = gz - j0;
        const i1 = Math.min(res - 1, i0 + 1); const j1 = Math.min(res - 1, j0 + 1);
        const a = tot[(j0 * res) + i0]; const b = tot[(j0 * res) + i1];
        const c = tot[(j1 * res) + i0]; const d = tot[(j1 * res) + i1];
        return (((a * (1 - fx)) + (b * fx)) * (1 - fz)) + (((c * (1 - fx)) + (d * fx)) * fz);
    };
}

const mirror = heightMirror();
const baked = bakeGroundSunFields(mirror, RES);
const atlas = bakeGroundAtlas();

describe('the world plate carries four fields and keeps the first one', () => {
    /**
     * R IS A CONTRACT, not an implementation detail: the water material samples this same
     * texture for its own sun visibility. Widening R16F to RGBA16F is only free if R comes out
     * bit-for-bit what the single-channel bake produced, so the legacy march is recomputed here
     * and compared. If this fails, the sun moved for the sea but not for the land.
     */
    it('reproduces the legacy sun-visibility march EXACTLY in R', () => {
        const len = Math.hypot(...ODYSSEY_WORLD_SUN);
        const [sx, sy, sz] = ODYSSEY_WORLD_SUN.map((v) => v / len);
        const horiz = Math.hypot(sx, sz) || 1e-4;
        const dirX = sx / horiz; const dirZ = sz / horiz; const rise = sy / horiz;
        const step = GROUND_BAKE_EXTENT / RES;
        const origin = -GROUND_BAKE_EXTENT / 2;
        const legacy = new Float32Array(RES * RES);
        for (let j = 0; j < RES; j += 1) {
            const z0 = origin + (j * step);
            for (let i = 0; i < RES; i += 1) {
                const x0 = origin + (i * step);
                const h0 = mirror(x0, z0);
                let shadow = 0;
                let t = step * 1.5;
                for (let k = 0; k < 42; k += 1) {
                    const terrain = mirror(x0 + (dirX * t), z0 + (dirZ * t));
                    const ray = h0 + (rise * t);
                    if (terrain > ray) {
                        shadow = Math.max(shadow, Math.min(1, ((terrain - ray) / (1 + (t * 0.05))) * 0.5));
                        if (shadow >= 1) break;
                    }
                    t *= 1.115;
                }
                legacy[(j * RES) + i] = 1 - shadow;
            }
        }
        const at = (i, j) => legacy[(Math.max(0, Math.min(RES - 1, j)) * RES) + Math.max(0, Math.min(RES - 1, i))];
        const { data } = baked.tex.image;
        let worst = 0;
        for (let j = 0; j < RES; j += 1) {
            for (let i = 0; i < RES; i += 1) {
                let sum = 0;
                for (let dj = -1; dj <= 1; dj += 1) {
                    for (let di = -1; di <= 1; di += 1) sum += at(i + di, j + dj);
                }
                const expected = THREE.DataUtils.toHalfFloat(sum / 9);
                worst = Math.max(worst, Math.abs(data[(((j * RES) + i) * 4)] - expected));
            }
        }
        expect(worst).toBe(0);
    });

    it('is an RGBA half-float plate clamped at its edges, like the bake it replaces', () => {
        expect(baked.tex.format).toBe(THREE.RGBAFormat);
        expect(baked.tex.type).toBe(THREE.HalfFloatType);
        expect(baked.tex.wrapS).toBe(THREE.ClampToEdgeWrapping);
        expect(baked.tex.generateMipmaps).toBe(false);
        expect(baked.tex.image.data.length).toBe(RES * RES * 4);
    });

    /**
     * THE FLAT-FIELD GUARD — the defect this suite exists for.
     *
     * Every authored channel computed correctly on the first cut and came out useless: wide
     * occlusion measured p10 0.965 on land (a term that did nothing), moisture p10 0.687 /
     * p50 0.920 (the whole island inside one decile), and the zone field spanned 0.742..0.918.
     * A flat field breaks nothing, throws nothing, and silently deletes the feature it was
     * added for — so the contrast is asserted, not hoped for.
     */
    it('gives every authored field real contrast ON LAND', () => {
        const { ao, moisture, zone } = baked.stats;
        expect(baked.stats.landTexels).toBeGreaterThan(RES * RES * 0.02);
        expect(moisture.p90 - moisture.p10).toBeGreaterThan(0.45);
        expect(zone.p90 - zone.p10).toBeGreaterThan(0.45);
        // AO is remapped onto [floor, 1], so its span is bounded by the floor by construction.
        expect(ao.p90 - ao.p10).toBeGreaterThan(0.12);
        expect(ao.p10).toBeLessThan(0.85);
    });

    /**
     * Statistics must be LAND statistics. Over the whole 9,000 u plate the island is under a
     * tenth of the texels and the ocean pins every field at its extreme — unmasked deciles
     * report "flat" for a field that is well spread everywhere anyone can see it.
     */
    it('measures its own fields over land, not over the ocean that dominates the plate', () => {
        expect(baked.stats.landTexels).toBeLessThan(RES * RES * 0.5);
    });

    it('bakes deterministically', () => {
        const again = bakeGroundSunFields(mirror, RES);
        expect(Array.from(again.tex.image.data)).toEqual(Array.from(baked.tex.image.data));
    });

    it('keeps the shore damper than the ridges it drains into', () => {
        // The ordering is the part the terms own (the stretch owns only the range), so the
        // ordering is what a test can hold: a point just above the waterline must read damper
        // than a high, convex one. Sampled from the field, not from the formula.
        const { data } = baked.tex.image;
        const step = GROUND_BAKE_EXTENT / RES;
        const origin = -GROUND_BAKE_EXTENT / 2;
        const moistAt = (x, z) => {
            const i = Math.round((x - origin) / step); const j = Math.round((z - origin) / step);
            const k = ((Math.min(RES - 1, Math.max(0, j)) * RES) + Math.min(RES - 1, Math.max(0, i))) * 4;
            return THREE.DataUtils.fromHalfFloat(data[k + 2]);
        };
        const samples = [];
        for (let x = -2400; x <= 2400; x += 120) {
            for (let z = -2400; z <= 2400; z += 120) {
                const h = mirror(x, z);
                if (h > ODYSSEY_SEA_LEVEL) samples.push({ h, m: moistAt(x, z) });
            }
        }
        expect(samples.length).toBeGreaterThan(50);
        const low = samples.filter((s) => s.h < ODYSSEY_SEA_LEVEL + 60);
        const high = samples.filter((s) => s.h > ODYSSEY_SEA_LEVEL + 300);
        const mean = (a) => a.reduce((t, s) => t + s.m, 0) / Math.max(1, a.length);
        expect(low.length).toBeGreaterThan(5);
        expect(high.length).toBeGreaterThan(5);
        expect(mean(low)).toBeGreaterThan(mean(high));
    });
});

describe('the tiling atlas closes and stays mean-transparent', () => {
    /**
     * THE TILING TEST, PER AXIS — and the reason it must be.
     *
     * The house rule is that a tiling test compares texel 255 against texel 0, never against
     * texel 256. This atlas adds a second trap on top of that: its grass and rock channels are
     * ANISOTROPIC (strokes stretched by integer factors), so the field genuinely steps ~5x
     * faster along the stretched axis than across it. A seam judged against the wrong axis's
     * interior step reads as a defect when the tile is closing perfectly — which is exactly
     * what the first probe of this bake reported.
     */
    it('closes on both axes, judged against each axis own interior step', () => {
        const res = Math.sqrt(atlas.fields[0].length);
        atlas.fields.forEach((f, c) => {
            let seamH = 0; let seamV = 0; let intH = 0; let intV = 0;
            for (let i = 0; i < res; i += 1) {
                seamH = Math.max(seamH, Math.abs(f[(i * res) + res - 1] - f[i * res]));
                seamV = Math.max(seamV, Math.abs(f[((res - 1) * res) + i] - f[i]));
                for (let k = 1; k < res; k += 1) {
                    intH = Math.max(intH, Math.abs(f[(i * res) + k] - f[(i * res) + k - 1]));
                    intV = Math.max(intV, Math.abs(f[(k * res) + i] - f[((k - 1) * res) + i]));
                }
            }
            expect(seamH, `channel ${c} horizontal seam`).toBeLessThanOrEqual(intH);
            expect(seamV, `channel ${c} vertical seam`).toBeLessThanOrEqual(intV);
        });
    });

    /**
     * THE WOLFIRE INVARIANT. The shader multiplies albedo by `tile / avg`, and the entire
     * promise of that division — the technique The Witness took from Wolfire so that "the
     * repeating detail texture is color-corrected so that its average color corresponds to the
     * whole-island-color-map's color at that position" — is that the ratio's mean is 1. If it
     * is not, tiled detail silently darkens or brightens every material it lands on, and the
     * painted colour stops being the colour.
     */
    it('publishes an average that makes the applied ratio mean exactly one', () => {
        atlas.fields.forEach((f, c) => {
            const mean = f.reduce((a, b) => a + b, 0) / f.length;
            expect(Math.abs((mean / atlas.avg[c]) - 1), `channel ${c}`).toBeLessThan(1e-3);
        });
    });

    it('gives each material a different KIND of mark, not one grain in four channels', () => {
        // Correlation between channels must be weak, or the four-channel atlas is one channel
        // wearing four hats and material identity collapses to a tint difference.
        const [g, r, s] = atlas.fields;
        const corr = (a, b) => {
            const n = a.length;
            const ma = a.reduce((x, y) => x + y, 0) / n; const mb = b.reduce((x, y) => x + y, 0) / n;
            let num = 0; let da = 0; let db = 0;
            for (let i = 0; i < n; i += 1) {
                num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2;
            }
            return num / Math.sqrt(da * db);
        };
        expect(Math.abs(corr(g, r))).toBeLessThan(0.6);
        expect(Math.abs(corr(g, s))).toBeLessThan(0.6);
        expect(Math.abs(corr(r, s))).toBeLessThan(0.6);
    });

    it('repeats, half-floats, and skips mipmaps like the detail bake beside it', () => {
        expect(atlas.tex.wrapS).toBe(THREE.RepeatWrapping);
        expect(atlas.tex.wrapT).toBe(THREE.RepeatWrapping);
        expect(atlas.tex.type).toBe(THREE.HalfFloatType);
        expect(atlas.tex.generateMipmaps).toBe(false);
    });

    it('bakes deterministically', () => {
        const again = bakeGroundAtlas();
        expect(Array.from(again.tex.image.data)).toEqual(Array.from(atlas.tex.image.data));
        expect(again.avg).toEqual(atlas.avg);
    });
});

describe('the palette encodes the measured bar, not a taste', () => {
    it('splits saturation by material family — the identity the bar names (G2)', () => {
        const veg = ['grass', 'sand'];
        const min = ['rock', 'snow'];
        const worstVeg = Math.min(...veg.flatMap((m) => [
            groundPaletteSaturation(ODYSSEY_GROUND_PALETTE[m].damp),
            groundPaletteSaturation(ODYSSEY_GROUND_PALETTE[m].dry),
        ]));
        const bestMin = Math.max(...min.flatMap((m) => [
            groundPaletteSaturation(ODYSSEY_GROUND_PALETTE[m].damp),
            groundPaletteSaturation(ODYSSEY_GROUND_PALETTE[m].dry),
        ]));
        // Lit vegetation/sand 0.56-0.79 against lit rock 0.10-0.38: the two ranges must not
        // overlap, or the contrast that makes a material readable at 720p is gone.
        expect(worstVeg).toBeGreaterThan(bestMin);
        expect(worstVeg).toBeGreaterThan(0.55);
    });

    it('crosses grass over to red-above-green at the dry pole (G6)', () => {
        // Ref1's lawn holds golden 126/92/35 (red ABOVE green) beside green 96/108/35 — one
        // lawn, two hues. Without the crossover the island can only ever be "a green place".
        const { damp, dry } = ODYSSEY_GROUND_PALETTE.grass;
        expect(damp[1]).toBeGreaterThan(damp[0]);
        expect(dry[0]).toBeGreaterThan(dry[1]);
    });

    it('keeps every damp pole darker than its dry one', () => {
        Object.entries(ODYSSEY_GROUND_PALETTE).forEach(([name, m]) => {
            expect(groundPaletteLuma(m.damp), name).toBeLessThan(groundPaletteLuma(m.dry));
        });
    });

    it('orders the ambients deep < mineral < vegetation (G1/G8)', () => {
        const { deepAmbient, mineral, vegetation } = ODYSSEY_GROUND_SHADE;
        expect(deepAmbient).toBeLessThan(mineral.ambient);
        expect(mineral.ambient).toBeLessThan(vegetation.ambient);
        // Deep shade lands at x0.27-0.32 of full sun in every reference frame.
        expect(vegetation.ambient).toBeGreaterThan(0.24);
        expect(vegetation.ambient).toBeLessThan(0.34);
    });

    it('desaturates rock in shade and leaves vegetation alone (G1)', () => {
        // The measured asymmetry, and the reason no blue tint appears anywhere in the graph:
        // desaturating a warm colour raises its relative blue by itself.
        expect(ODYSSEY_GROUND_SHADE.vegetation.desat).toBe(0);
        expect(ODYSSEY_GROUND_SHADE.mineral.desat).toBeGreaterThan(0.3);
    });

    it('keeps the deep-shade tint warm and luma-neutral', () => {
        const t = ODYSSEY_GROUND_SHADE.deepTint;
        expect(t[0]).toBeGreaterThan(t[2]); // red-enriched, never blue-black
        // Luma-neutral so the ratio has exactly one owner (`ambient`), not two.
        expect(Math.abs(groundPaletteLuma(t) - 1)).toBeLessThan(0.02);
    });

    /**
     * THE STRATA GATE — the defect a debug shade found and a number can now hold.
     *
     * Strata shipped invisible for three captures because its slope window opened at 0.26 while
     * rock itself starts appearing at slope 0.17: every banded fragment was also snow-covered
     * summit. The bands existed, were correctly scaled, and could never be seen. So the gate is
     * pinned BELOW the slope at which rock becomes visible, which is the actual requirement.
     */
    it('opens the strata gate below the slope where rock first appears', () => {
        const ROCK_SLOPE_ONSET = 0.17; // wRock's smoothstep(0.17, 0.40, slope) in the renderer
        expect(ODYSSEY_GROUND_STRATA.slope[0]).toBeLessThan(ROCK_SLOPE_ONSET);
        expect(ODYSSEY_GROUND_STRATA.slope[1]).toBeGreaterThan(ODYSSEY_GROUND_STRATA.slope[0]);
        // A step small enough to be invisible is the same defect wearing a different number:
        // +-8% of value on pale rock measured as no band at all against a bar of 30-45/255.
        expect(ODYSSEY_GROUND_STRATA.step).toBeGreaterThan(0.25);
    });

    it('warps strata by less than a band, so sediment wobbles instead of shattering', () => {
        // The dissolve law: a band narrower than its own noise swing tears into confetti.
        expect(ODYSSEY_GROUND_STRATA.warp).toBeLessThan(ODYSSEY_GROUND_STRATA.band * 2);
    });

    it('keeps dryness a minority read, since the moisture stretch fixes the proportions', () => {
        // The window is the ONLY lever on how much of the island goes gold — the field is
        // percentile-stretched over land, so uniform term changes are no-ops by construction.
        const [hi, lo] = ODYSSEY_GROUND_DRYNESS;
        expect(hi).toBeGreaterThan(lo);
        expect(lo).toBeLessThan(0.25);
    });
});
