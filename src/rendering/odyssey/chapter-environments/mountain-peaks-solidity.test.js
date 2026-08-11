import { describe, expect, it } from 'vitest';

import { MOUNTAIN_RIM_FADE } from './mountain-peaks.tsl.js';
import {
    MOUNTAIN_DISPLACEMENT,
    mountainCpuDisplacement,
} from './shared/mountain-language.js';
import { getCanonicalMountainRangeWorldSpecs } from './shared/canonical-mountain-range.js';

// In-game report (2026-08): "Why can I see straight through the hero mountain? I see like
// mountains behind the hero mountain, it does not feel solid."
//
// Cause: the peak's alpha rim fade was RECTANGULAR — a per-axis ramp over uv 0→0.16 and
// 0.84→1.0 — while the displaced silhouette is a CIRCULAR cone reaching only
// `coneRadiusFrac` (0.45) from centre. On the 1340u hero that put 147u of standing
// mountain per side inside the fade band, at alpha 0.59–0.89. Those fragments pass
// alphaTest and write depth, but still blend with everything drawn earlier — so the
// far-range flank (renderOrder −3) and the foothill apron (−2) painted through the
// massif's own shoulders.
//
// These guards fix the INVARIANT rather than the numbers: wherever alpha starts to drop,
// the geometry must already have closed. They fail against the pre-fix band (see the
// falsification test at the bottom).

/** Highest displaced point on a ring of the given radius, as a fraction of `height`. */
function maxHeightFractionOnRing(spec, radiusFraction, samples = 512) {
    const radius = spec.size * radiusFraction;
    let peak = 0;
    for (let i = 0; i < samples; i += 1) {
        const theta = (i / samples) * Math.PI * 2;
        const h = mountainCpuDisplacement(
            Math.cos(theta) * radius,
            Math.sin(theta) * radius,
            { size: spec.size, height: spec.height, seed: spec.seed },
        );
        peak = Math.max(peak, h);
    }
    return peak / spec.height;
}

describe('canonical mountain solidity', () => {
    const specs = getCanonicalMountainRangeWorldSpecs({ includeFarRange: true });

    it('never starts the alpha rim fade inside the displaced footprint', () => {
        // The worst case is the fade start pulled INWARD by the full edge-noise wobble.
        const worstCaseStart = MOUNTAIN_RIM_FADE.startFrac - (MOUNTAIN_RIM_FADE.noiseAmplitude / 2);
        expect(worstCaseStart).toBeGreaterThanOrEqual(MOUNTAIN_DISPLACEMENT.coneRadiusFrac);
        expect(MOUNTAIN_RIM_FADE.endFrac).toBeGreaterThan(MOUNTAIN_RIM_FADE.startFrac);
    });

    it('dissolves over a band wider than its own noise wobble', () => {
        // A dissolve band narrower than the noise that perturbs it snaps hard instead of
        // feathering — the same trap the Ch3 shoreline hit.
        const band = MOUNTAIN_RIM_FADE.endFrac - MOUNTAIN_RIM_FADE.startFrac;
        expect(band).toBeGreaterThan(MOUNTAIN_RIM_FADE.noiseAmplitude * 1.5);
    });

    it.each(specs.map((spec) => [spec.id, spec]))(
        '%s has closed to a flat rim before any alpha is lost',
        (_id, spec) => {
            const worstCaseStart = MOUNTAIN_RIM_FADE.startFrac
                - (MOUNTAIN_RIM_FADE.noiseAmplitude / 2);
            // Nothing taller than 3% of the peak's height may still be standing where the
            // fade begins, or the flank goes see-through instead of the flat margin.
            expect(maxHeightFractionOnRing(spec, worstCaseStart)).toBeLessThan(0.03);
        },
    );

    it.each(specs.map((spec) => [spec.id, spec]))(
        '%s keeps its whole visible body at full alpha',
        (_id, spec) => {
            // Sample the body from centre out to the fade start: every ring that carries
            // real relief (>3% of height) must sit strictly inside the opaque region.
            const worstCaseStart = MOUNTAIN_RIM_FADE.startFrac
                - (MOUNTAIN_RIM_FADE.noiseAmplitude / 2);
            let outermostStandingRing = 0;
            for (let r = 0.05; r <= 0.5; r += 0.005) {
                if (maxHeightFractionOnRing(spec, r, 128) > 0.03) outermostStandingRing = r;
            }
            expect(outermostStandingRing).toBeGreaterThan(0.2); // sanity: there IS a mountain
            expect(outermostStandingRing).toBeLessThanOrEqual(worstCaseStart);
        },
    );

    it('would have failed against the rectangular rim fade it replaced', () => {
        // Falsification. The old band began at uv 0.16 from the edge — a RADIUS of
        // 0.5 − 0.16 = 0.34 along the axes. Confirm the guard above discriminates.
        const hero = specs.find((spec) => spec.id === 'ch4-center-hero');
        expect(maxHeightFractionOnRing(hero, 0.34)).toBeGreaterThan(0.2);
    });

    it('drops the far-range right flank that ghosted behind the hero shoulder', () => {
        // Removed on in-game feedback: at only +560 off-centre it projected INSIDE the
        // massif's span, so it read as a ridge behind the hero rather than as a flank.
        expect(specs.map((spec) => spec.id)).not.toContain('ch4-far-right');
        expect(specs.map((spec) => spec.id)).toContain('ch4-far-left');
    });
});
