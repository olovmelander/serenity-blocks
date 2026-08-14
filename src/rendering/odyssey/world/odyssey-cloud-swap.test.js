import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * WAVE 4 — the sculpted cloud field is Act II's sky, and the flat sheet is RETAINED.
 *
 * Source assertions, for the same reason `odyssey-world-default.test.js` uses them:
 * `createOdysseyWorld` needs a WebGPU device, and what is worth pinning here is a POLICY —
 * which sky ships, whether the retired one can still be brought back, and whether the bisect
 * levers still point at what their names claim.
 *
 * That last one is not padding. This exact file's levers have produced a WRONG MEASUREMENT
 * twice in this feature's life:
 *   • `odysseyWorldNoHeroes` was read by a code path that no longer drew the heroes, so the
 *     bisect "proved" the heroes were not the white slab — a flag that silently does nothing
 *     reports innocence, not absence.
 *   • `heroesMs` was sign-flipped TWICE (arguments swapped AND negated), which cancels out to
 *     look plausible while being derived backwards.
 * A lever's polarity has to follow what SHIPS, and when the shipped default flips, every
 * lever that names it flips with it. Hence these tests live beside the swap, not in the
 * harness.
 */

const ROOT = path.resolve(
    path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
    '../../../..',
);
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const RENDERER = read('src/rendering/odyssey/world/odyssey-world-renderer.js');
const BOARD = read('src/rendering/odyssey/OdysseyBoardController.js');
const SPLIT = read('scripts/odyssey-gpu-split.mjs');

describe('the sculpted cloud field is the shipped Act II sky', () => {
    it('defaults the field ON and the flat sheet OFF in the renderer signature', () => {
        // Loose on surrounding whitespace on purpose — `clouds` shares a line with the other
        // scalar defaults, and this test is about the VALUE, not the formatting.
        expect(RENDERER).toMatch(/\bcloudField = true,/);
        expect(RENDERER).toMatch(/\bclouds = false,/);
        expect(RENDERER).not.toMatch(/\bclouds = true,/);
        expect(RENDERER).not.toMatch(/\bcloudField = false,/);
    });

    it('reads the field as opt-OUT and the sheet as opt-IN on the board', () => {
        expect(BOARD).toMatch(/cloudField:\s*!readBooleanUrlFlag\('odysseyWorldNoCloudField'\)/);
        expect(BOARD).toMatch(/clouds:\s*readBooleanUrlFlag\('odysseyWorldCloudSheet'\)/);
        // The inverse of each. If either of these ever matches, the polarity has flipped back
        // and every bisect run against it is measuring the opposite of its own label.
        expect(BOARD).not.toMatch(/cloudField:\s*readBooleanUrlFlag\(/);
        expect(BOARD).not.toMatch(/clouds:\s*!readBooleanUrlFlag\(/);
    });

    // ADR-0015: a retired feature keeps its module, its tests and a way back. Asserting the
    // DEFAULT alone would still pass if someone "cleaned up" by deleting the sheet outright,
    // which is precisely the outcome the owner declined when they said to keep it.
    it('keeps the retired sheet buildable, not merely switched off', () => {
        expect(RENDERER).toMatch(/cloudMat/);
        expect(RENDERER).toMatch(/if \(clouds\)/);
        expect(RENDERER).toMatch(/cloudMesh/);
    });

    // The Wave 0 measured defect, which the field inherits by sharing the heroes' altitude
    // band: a sky-covering mesh submitted at a fully submerged station rasterises for nothing.
    // A multiply by a zero uniform is NOT dead-code-eliminated, so the gate must be a CPU
    // `.visible` write.
    it('gates the field underwater on the CPU, like the sheet and the heroes before it', () => {
        expect(RENDERER).toMatch(
            /fieldProbeMesh\.visible = uSubmerged\.value < 0\.999/,
        );
    });
});

describe('the gpu-split levers still point at what they measure', () => {
    it('prices the sheet by ADDING it back and the field by REMOVING it', () => {
        // Argument order carries the sign — `delta(a, b)` is a minus b. The shipped
        // configuration must be the one that CONTAINS the feature, so:
        //   sheet is retired  -> its lever ADDS it    -> cost = configuration - baseline
        //   field ships       -> its lever REMOVES it -> cost = baseline - configuration
        expect(SPLIT).toMatch(/cloudsMs:\s*delta\('cloud-sheet',\s*'baseline'\)/);
        expect(SPLIT).toMatch(/cloudFieldMs:\s*delta\('baseline',\s*'no-cloud-field'\)/);
    });

    it('drives those configurations with the flags the board actually reads', () => {
        expect(SPLIT).toMatch(/odysseyWorldCloudSheet:\s*'1'/);
        expect(SPLIT).toMatch(/odysseyWorldNoCloudField:\s*'1'/);
        // `odysseyWorldNoClouds` was the sheet's old lever. It is no longer read anywhere, so
        // a configuration still driving it would collect a p50 identical to baseline and
        // report a real cost as zero — the failure mode that made the heroes look innocent.
        expect(SPLIT).not.toMatch(/odysseyWorldNoClouds/);
        expect(BOARD).not.toMatch(/readBooleanUrlFlag\('odysseyWorldNoClouds'\)/);
    });
});
