import { describe, expect, it } from 'vitest';
import { bakeOdysseyCloudField } from './odyssey-world-renderer.js';

/**
 * THE CLOUD DECK'S SILHOUETTE FIELD — the invariants a capture cannot check cheaply.
 *
 * This field is sampled with RepeatWrapping at three world scales (~488 / ~179 / ~70 u), so
 * any discontinuity in it is drawn across Act II's sky as a dead straight line, repeating on
 * a lattice. It shipped with two of them, found 2026-08-13 and measured here rather than
 * argued about:
 *
 *  1. the value noise did not tile (its hash wrapped at the texture resolution instead of at
 *     the lattice cell count), and
 *  2. the histogram match ranked TIED texels individually, so the 64 % of the field that is
 *     exactly zero — the sky between the disc clusters — came out as a ramp in texel order
 *     that stepped 0.394 at the wrap.
 *
 * Against those builds the seam assertion below read 48x and 42x the interior step. The
 * deck's whole anti-aliased alpha edge is 0.06 wide, so either one takes the sky from clear
 * to solid cloud in a single texel.
 */
describe('odyssey cloud silhouette field', () => {
    const RES = 256;
    const { field, stats } = bakeOdysseyCloudField(RES);
    const at = (i, j) => field[((((j % RES) + RES) % RES) * RES) + (((i % RES) + RES) % RES)];

    /** Mean absolute step between horizontally adjacent texels, away from the wrap. */
    const interiorStep = () => {
        let sum = 0;
        let n = 0;
        for (let j = 0; j < RES; j += 1) {
            for (let i = 0; i < RES - 1; i += 1) { sum += Math.abs(at(i, j) - at(i + 1, j)); n += 1; }
        }
        return sum / n;
    };

    it('has no discontinuity at either tile seam', () => {
        const interior = interiorStep();
        let seamU = 0;
        let seamV = 0;
        for (let k = 0; k < RES; k += 1) {
            // RepeatWrapping makes texel RES-1 the bilinear neighbour of texel 0. That pair —
            // not texel RES — is what the GPU actually interpolates across.
            seamU += Math.abs(at(RES - 1, k) - at(0, k));
            seamV += Math.abs(at(k, RES - 1) - at(k, 0));
        }
        expect(seamU / RES).toBeLessThan(interior * 3);
        expect(seamV / RES).toBeLessThan(interior * 3);
    });

    it('has a seam step DISTRIBUTION that looks like anywhere else in the tile', () => {
        // Not a worst-case test, deliberately. This field's largest legitimate step is the
        // rim of a disc, where the union's dome falls to the sky floor; that cliff is ~0.25
        // and it occurs all over the tile, so a "worst seam step" bound would either be
        // useless (both builds have a 0.41 max — checked) or would fail the shipped field for
        // doing exactly what it is designed to do. What must hold is that the WRAP is not a
        // special place: its step distribution has to sit inside the interior's. Pre-fix the
        // seam's p99 was 0.395 against an interior p99 of 0.033.
        const steps = (pairs) => pairs.sort((a, b) => a - b);
        const interior = [];
        for (let j = 0; j < RES; j += 1) {
            for (let i = 0; i < RES - 1; i += 1) interior.push(Math.abs(at(i, j) - at(i + 1, j)));
            for (let i = 0; i < RES; i += 1) if (j < RES - 1) interior.push(Math.abs(at(i, j) - at(i, j + 1)));
        }
        const seam = [];
        for (let k = 0; k < RES; k += 1) {
            seam.push(Math.abs(at(RES - 1, k) - at(0, k)));
            seam.push(Math.abs(at(k, RES - 1) - at(k, 0)));
        }
        const p99 = (a) => steps(a)[Math.floor(a.length * 0.99)];
        expect(p99(seam)).toBeLessThanOrEqual(p99(interior));
    });

    it('maps equal inputs to equal outputs — the remap is a function of value, not of index', () => {
        // The sky between clusters is one input value. However many texels hold it, they must
        // all leave the remap holding ONE output value, or the field carries a texel-order
        // ramp that no threshold comment in the deck describes.
        const counts = new Map();
        for (let k = 0; k < field.length; k += 1) {
            const key = field[k].toFixed(6);
            counts.set(key, (counts.get(key) || 0) + 1);
        }
        const biggest = Math.max(...counts.values());
        // Pre-fix this was 1: every tied texel had its own value.
        expect(biggest).toBeGreaterThan(field.length * 0.25);
    });

    it('keeps the coverage calibration the deck thresholds were placed against', () => {
        // The solver targets the SUM's spread; that is the number it actually controls.
        expect(stats.p90 - stats.p10).toBeCloseTo(0.28, 2);
        // The percentiles themselves are recorded, not asserted tightly: collapsing the tie
        // block moved the sum's median from 0.563 to 0.549, which is a real change in the
        // field's shape and is accounted for in the deck's coverage thresholds, not hidden.
        expect(stats.p10).toBeGreaterThan(0.40);
        expect(stats.p10).toBeLessThan(0.45);
        expect(stats.p50).toBeGreaterThan(0.53);
        expect(stats.p50).toBeLessThan(0.60);
        expect(stats.p90).toBeGreaterThan(0.68);
        expect(stats.p90).toBeLessThan(0.73);
    });
});
