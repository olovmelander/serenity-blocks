import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
    GROUND_ATLAS_RES,
    bakeGroundAtlas,
    bakeGroundSunFields,
} from '../../src/rendering/odyssey/world/odyssey-ground-bakes.js';
import { bakeOdysseyCloudField } from '../../src/rendering/odyssey/world/odyssey-world-renderer.js';

/**
 * GOLDEN OUTPUT SUITE for the One World boot bakes.
 *
 * WHY (2026-08-17). These bakes paint the colour STRUCTURE of two thirds of the journey, they
 * run once at boot, and until now **nothing asserted their output**. This repo has already been
 * bitten by exactly that gap twice: the ch5 "razor edges" turned out to be two defects in the
 * BAKE (noise that never tiled, plus a rank-remap of tied texels) and not in the shader, and they
 * were only found by re-shading a comparison deck by hand.
 *
 * These bakes are pure CPU and deterministic (verified: repeated invocations are byte-identical),
 * so they can be pinned by hash with no GPU. That matters for more than regressions — it is what
 * makes the pending load-time work SAFE to do. The 1 419 ms One World build (711 ms of it these
 * texture bakes) is the largest single block on the critical path, and the fix is to move it off
 * the main thread (worker) or off runtime entirely (precomputed asset). Either way the question
 * "did the pixels move?" must be answerable without a screenshot — and a byte-identical hash is a
 * STRONGER guarantee than a capture, because it admits no tolerance at all.
 *
 * If a hash here changes, that is not automatically a failure — it means the painting changed.
 * Re-verify the chapter visually, then update the hash IN THE SAME COMMIT as the bake change so
 * the pairing stays reviewable.
 */

const sha = (typed) => createHash('sha256')
    .update(Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength))
    .digest('hex')
    .slice(0, 32);

describe('ground atlas bake', () => {
    const atlas = bakeGroundAtlas();

    it('is byte-stable across invocations (the precondition for precomputing it)', () => {
        expect(sha(bakeGroundAtlas().tex.image.data)).toBe(sha(atlas.tex.image.data));
    });

    it('pins the painted atlas', () => {
        expect(atlas.tex.image.width).toBe(GROUND_ATLAS_RES);
        expect(atlas.tex.image.height).toBe(GROUND_ATLAS_RES);
        expect(sha(atlas.tex.image.data)).toBe('5f8129426b1853fce107d5463b6a3f88');
    });

    it('keeps each channel average mid-range — a flat or blown channel is the failure mode', () => {
        // Four channels: grass / rock / sand / tooth. If a rebake ever flattens one, the whole
        // palette that hangs off it silently changes meaning.
        expect(atlas.avg).toHaveLength(4);
        atlas.avg.forEach((v) => {
            expect(v).toBeGreaterThan(0.05);
            expect(v).toBeLessThan(0.95);
        });
    });
});

describe('ground sun-fields bake', () => {
    // A synthetic, deterministic height field — deliberately NOT the real relief, so this pins
    // the SHADOWING LOGIC independently of the terrain it happens to be run over.
    //
    // Two constraints make this relief non-arbitrary. The bake spans GROUND_BAKE_EXTENT = 9000
    // over `shadowRes` texels, so at res 64 one texel is ~141 world units: features must be far
    // coarser than that or the plate just aliases. And ODYSSEY_WORLD_SUN sits ~25° above the
    // horizon, so slopes must EXCEED ~25° or nothing self-shadows and the bake is uniformly lit —
    // which is what a gentler first draft of this relief produced, correctly.
    const heightAt = (x, z) => (
        600 * Math.sin(x / 286) * Math.cos(z / 350)
    ) + (150 * Math.sin((x + z) / 180));

    it('is byte-stable across invocations', () => {
        const a = bakeGroundSunFields(heightAt, 64);
        const b = bakeGroundSunFields(heightAt, 64);
        expect(sha(a.tex.image.data)).toBe(sha(b.tex.image.data));
    });

    it('pins the shadowing logic over a fixed synthetic relief', () => {
        const fields = bakeGroundSunFields(heightAt, 64);
        expect(fields.tex.image.width).toBe(64);
        expect(sha(fields.tex.image.data)).toBe('d0fef689ee6f34aa7e0aea50e9b1d4fb');
    });

    it('produces both lit and shadowed texels — a uniform plate means the sun march broke', () => {
        const { data } = bakeGroundSunFields(heightAt, 64).tex.image;
        const r = [];
        for (let i = 0; i < data.length; i += 4) r.push(data[i]);
        expect(Math.min(...r)).toBeLessThan(Math.max(...r));
    });
});

describe('cloud silhouette bake', () => {
    const baked = bakeOdysseyCloudField(64);

    it('is byte-stable across invocations', () => {
        expect(sha(bakeOdysseyCloudField(64).field)).toBe(sha(baked.field));
    });

    it('pins the silhouette field', () => {
        expect(baked.field).toHaveLength(64 * 64);
        expect(sha(baked.field)).toBe('6a714c6412d955929f96ac605bcbd7e8');
    });

    it('keeps the histogram the coverage thresholds are calibrated against', () => {
        // The deck's gate bands are tuned to these deciles; drift here silently re-meanings them.
        expect(baked.stats.p10).toBeLessThan(baked.stats.p50);
        expect(baked.stats.p50).toBeLessThan(baked.stats.p90);
        expect(baked.stats.p50).toBeGreaterThan(0);
        expect(baked.stats.p90).toBeLessThan(1);
    });
});
