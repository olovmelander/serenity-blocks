import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import {
    MORPH_END,
    buildOdysseyClipmap,
    morphEndCeiling,
    spacingForReach,
} from './odyssey-clipmap.js';

// The clipmap has two failure modes that produce NO error and NO warning: rings that crack
// because the morph runs past the overlap band, and bounds computed from the fake vertex data
// that make three cull the ground away. Both are cheap to assert and expensive to debug.

const LANE_A = {
    gridN: 128, levels: 9, baseSpacing: 1.6, holeShrink: 3,
};
const LANE_B = {
    gridN: 96, levels: 7, baseSpacing: 1.5, holeShrink: 2,
};

describe('the morph invariant', () => {
    it('is satisfied by both shipped lane configurations', () => {
        [LANE_A, LANE_B].forEach((cfg) => {
            expect(MORPH_END).toBeLessThanOrEqual(morphEndCeiling(cfg.gridN, cfg.holeShrink));
        });
    });

    it('THROWS rather than cracking silently when a config violates it', () => {
        // The obvious water configuration - a coarse lattice with the usual overlap - lands
        // at a ceiling of 0.75 against a morph end of 0.86, and would have torn.
        expect(morphEndCeiling(32, 2)).toBeCloseTo(0.75, 6);
        expect(() => buildOdysseyClipmap({
            gridN: 32, levels: 7, baseSpacing: 4, holeShrink: 2,
        })).toThrow(/crack/i);
    });

    it('accepts the corrected coarse configuration', () => {
        expect(morphEndCeiling(32, 1)).toBeCloseTo(0.875, 6);
        expect(() => buildOdysseyClipmap({
            gridN: 32, levels: 7, baseSpacing: 4, holeShrink: 1,
        })).not.toThrow();
    });

    it('rejects a gridN the lattice cannot be built from', () => {
        expect(() => buildOdysseyClipmap({ ...LANE_A, gridN: 30 })).toThrow(/multiple of 4/);
        expect(() => buildOdysseyClipmap({ ...LANE_A, levels: 0 })).toThrow(/positive integer/);
    });
});

describe('geometry', () => {
    it('carries no positions — only (gridIndex, ringLevel, gridIndex)', () => {
        const { geometry, gridN, levels } = buildOdysseyClipmap(LANE_B);
        const pos = geometry.attributes.position;
        expect(pos.count).toBe(levels * (gridN + 1) * (gridN + 1));
        // The Y channel is the ring level, never a height: it must be an integer in range.
        const seen = new Set();
        for (let i = 0; i < pos.count; i += 997) seen.add(pos.getY(i));
        seen.forEach((v) => {
            expect(Number.isInteger(v)).toBe(true);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(levels);
        });
        // And X/Z are lattice indices centred on zero, not world units.
        expect(pos.getX(0)).toBe(-gridN / 2);
        expect(pos.getZ(0)).toBe(-gridN / 2);
    });

    it('cuts a hole in every ring except level 0', () => {
        const solid = buildOdysseyClipmap({ ...LANE_B, levels: 1 });
        const nested = buildOdysseyClipmap({ ...LANE_B, levels: 2 });
        const ringTris = nested.triangles - solid.triangles;
        // A ring with a hole must carry FEWER triangles than the solid square it surrounds.
        expect(ringTris).toBeGreaterThan(0);
        expect(ringTris).toBeLessThan(solid.triangles);
    });

    it('assigns real bounds, not bounds derived from the fake vertex data', () => {
        const { geometry, reach } = buildOdysseyClipmap(LANE_A);
        // Left to itself three would compute a radius of ~113 grid units from (i, level, j).
        expect(geometry.boundingSphere.radius).toBeGreaterThan(reach);
        expect(geometry.boundingBox.max.x).toBeCloseTo(reach, 3);
        expect(geometry.boundingBox.min.y).toBeLessThan(0);
    });

    it('doubles reach per level for a fixed per-ring triangle cost', () => {
        // This is the property that made the plan's pre-baked far-range LUTs unnecessary:
        // measured, LEVELS 7 -> 10 took reach 6,554 -> 52,429 at byte-identical GPU time.
        const a = buildOdysseyClipmap({ ...LANE_B, levels: 7 });
        const b = buildOdysseyClipmap({ ...LANE_B, levels: 10 });
        expect(b.reach / a.reach).toBeCloseTo(8, 6);
        const perRingA = (a.triangles - 0) / a.levels;
        const perRingB = (b.triangles - 0) / b.levels;
        // Cost per ring is near-constant, so 8x the reach costs well under 2x the triangles.
        expect(perRingB / perRingA).toBeGreaterThan(0.9);
        expect(perRingB / perRingA).toBeLessThan(1.1);
        expect(b.triangles / a.triangles).toBeLessThan(1.6);
    });
});

// ── STAGE DISCIPLINE (the third "square sections" defect, 2026-08-14) ─────────────────
//
// `clipmapXZ` returns `worldXZ = origin + mix(local, coarse, morph)`, and BOTH `origin` and
// `coarse` contain a `floor()`. In the VERTEX stage the grid coordinates are exact integers
// and the fold is seamless. But a FRAGMENT-stage node that reads `w.worldXZ` does not reuse
// the vertex result: r181 auto-varyings the raw `position` ATTRIBUTE and re-executes the whole
// chain per fragment, so the `floor()` runs on INTERPOLATED grid coordinates and goes
// piecewise-constant. Inside each ring's morph band — a SQUARE ANNULUS around the LOD centre —
// the shading coordinate then freezes across 2-cell blocks while the geometry glides smoothly
// past it, and the surface is painted in axis-aligned tiles of `2 * spacing * 2^ring`.
//
// This has now shipped three times (the water plate's original "square sections", the ch5 deck
// diagonals, and the underside ceiling the owner photographed), it produces no error and no
// warning, and each sighting cost a session to trace. It is invisible to every other test in
// this repo, which is exactly the bar this file's header sets.
//
// The rule: a fragment-stage node reads `positionWorld` (a real interpolated varying — three
// defines it as `modelWorldMatrix.mul(positionLocal).xyz.toVarying(...)`, and this water
// displaces VERTICALLY ONLY, so its .xz IS the smooth clipmap coordinate), or it reads an
// explicit `varying()`. It never reads `w.worldXZ`.
//
// Governing write-up: docs/ODYSSEY_GHIBLI_WATER_PLAN_2026-08.md §Wave 2b.
describe('clipmap stage discipline in the water material', () => {
    const RENDERER = join(dirname(fileURLToPath(import.meta.url)), 'odyssey-world-renderer.js');
    /**
     * Source with comments removed, so the prose ABOUT this rule cannot satisfy or break it.
     *
     * ⚠️ Block comments are replaced by their OWN NEWLINES, not by nothing. Collapsing them
     * shortens the array, and since `lineNumber` is an index into it, every reported offender
     * points at unrelated code: the water material sits below 17 JSDoc blocks worth 272
     * newlines, so a real violation at renderer:1461 was reported as 1211 — cloud code. A
     * lint that misdirects the next reader by 250 lines is worse than one printing no number.
     */
    const codeLines = readFileSync(RENDERER, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ''))
        .split('\n')
        .map((line) => line.replace(/\/\/.*$/, ''));

    // The only stage the clipmap fold may be read from is the vertex stage. Each entry is a
    // legitimate vertex-stage consumer; a new one is a deliberate one-line addition here, and
    // the reviewer's job is to confirm it really does run in the vertex stage.
    const VERTEX_STAGE_READERS = [
        /^\s*const wVertUv = /, // bed UV for the shallow-water taper (.level(0) fetch)
        /^\s*const wVertDist = /, // per-wave camera-distance envelope input
        /^\s*const swellVert = /, // the displacement field itself
        /^\s*waterMat\.positionNode = /, // the displacement, written to geometry
        /^\s*const wUv = varying\(/, // handed to the fragment stage EXPLICITLY
    ];

    it('reads the clipmap fold only from the vertex stage', () => {
        const offenders = codeLines
            .map((line, index) => ({ line, lineNumber: index + 1 }))
            .filter(({ line }) => line.includes('w.worldXZ'))
            .filter(({ line }) => !VERTEX_STAGE_READERS.some((allowed) => allowed.test(line)));

        expect(
            offenders.map(({ lineNumber, line }) => `${lineNumber}: ${line.trim()}`),
            'A fragment-stage node is reading the clipmap fold `w.worldXZ`. That re-runs its '
            + 'floor() on interpolated attributes and paints the water in axis-aligned morph-band '
            + 'squares — silently. Use positionWorld.xz, or hand the value across in a varying().',
        ).toEqual([]);
    });

    it('still has the vertex-stage readers it is meant to have', () => {
        // Guards the opposite failure: an allowlist that passes because the code it describes
        // was deleted or renamed, leaving the rule above asserting nothing at all.
        VERTEX_STAGE_READERS.forEach((allowed) => {
            expect(
                codeLines.some((line) => allowed.test(line) && line.includes('w.worldXZ')),
                `No line matches ${allowed} — the allowlist has drifted from the source.`,
            ).toBe(true);
        });
    });

    it('shades the sea from the interpolated world position', () => {
        // The positive half of the contract. Without this, "no w.worldXZ in the fragment" could
        // be satisfied by deleting the ripple normal outright, which is how the ceiling's
        // mottling would quietly disappear again.
        const source = codeLines.join('\n');
        ['const rippleA = ', 'const rippleB = '].forEach((decl) => {
            const line = codeLines.find((candidate) => candidate.includes(decl));
            expect(line, `${decl} not found`).toBeTruthy();
            expect(line, `${decl}must sample on positionWorld.xz`).toContain('positionWorld.xz');
        });
        // The whitecap break-up noise, and the crest term the underside's SSS rides.
        expect(source).toMatch(/const capNoise = snoise3\(vec3\(\s*positionWorld\.x/);
        expect(source).toContain("varying(swell, 'vSwell')");
        expect(source).toMatch(/const crestMask = clamp\(vSwell\./);
    });
});

describe('spacingForReach', () => {
    it('holds the horizon fixed while the lattice changes density', () => {
        const REACH = 26214.4;
        [64, 96, 128, 192].forEach((gridN) => {
            const baseSpacing = spacingForReach(REACH, gridN, 9);
            const built = buildOdysseyClipmap({
                gridN, levels: 9, baseSpacing, holeShrink: 1,
            });
            expect(built.reach).toBeCloseTo(REACH, 3);
        });
    });

    it('lets a coarser lane trade triangles for detail without moving the horizon', () => {
        const REACH = 26214.4;
        const fine = buildOdysseyClipmap({
            gridN: 128, levels: 9, holeShrink: 1, baseSpacing: spacingForReach(REACH, 128, 9),
        });
        const coarse = buildOdysseyClipmap({
            gridN: 64, levels: 9, holeShrink: 1, baseSpacing: spacingForReach(REACH, 64, 9),
        });
        expect(coarse.reach).toBeCloseTo(fine.reach, 3);
        expect(coarse.triangles).toBeLessThan(fine.triangles / 3);
    });
});
