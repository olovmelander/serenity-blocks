import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
    ODYSSEY_PEAK_SPECS,
    PEAK_CONE_RADIUS_FRAC,
} from '../../src/rendering/odyssey/world/odyssey-peak-specs.js';
import {
    CANONICAL_HERO_MOUNTAIN_SPEC_IDS,
    getCanonicalMountainRangeWorldSpecs,
} from '../../src/rendering/odyssey/chapter-environments/shared/canonical-mountain-range.js';
import { MOUNTAIN_DISPLACEMENT } from '../../src/rendering/odyssey/chapter-environments/shared/mountain-language.js';
import { getChapterPathRange } from '../../src/rendering/odyssey/path-utils.js';

/**
 * SPEC-AUTHORITY FLIP (Wave 4/6 audit, Tranche 2.2) — the WORLD owns the peak geometry.
 *
 * Before 2026-08-12 the truth pointed the other way: the four peak specs were authored in
 * the legacy diorama module, and the LIVE world's height-field test imported them as its
 * expectations — so the code Wave 4 wants to delete was the source of record for the code
 * that shipped. These tests pin the corrected direction: the authority is
 * world/odyssey-peak-specs.js, the legacy builder DERIVES from it, and the derived values
 * are exactly the ones validated in-game (the derivation was proven value-identical
 * against the pre-flip tests before they were rewritten).
 */

describe('the world owns the peak geometry; the legacy chain derives from it', () => {
    const specs = getCanonicalMountainRangeWorldSpecs({ includeFarRange: true });
    const chapter3Center = getChapterPathRange(3).center;
    const chapter4Center = getChapterPathRange(4).center;

    it('every legacy spec is the authority row + the live chapter centres, nothing more', () => {
        expect(specs).toHaveLength(ODYSSEY_PEAK_SPECS.length);
        ODYSSEY_PEAK_SPECS.forEach((peak) => {
            const derived = specs.find((s) => s.id === peak.id);
            expect(derived, `legacy builder must emit ${peak.id}`).toBeTruthy();
            expect(derived.size).toBe(peak.size);
            expect(derived.height).toBe(peak.height);
            expect(derived.seed).toBe(peak.seed);
            expect(derived.role).toBe(peak.role);
            expect(derived.worldPosition.x).toBeCloseTo(chapter4Center.x + peak.dx, 6);
            expect(derived.worldPosition.y).toBeCloseTo(chapter3Center.y + peak.footDy, 6);
            expect(derived.worldPosition.z).toBeCloseTo(chapter4Center.z + peak.dz, 6);
        });
    });

    it('the hero id list is derived from the authority, not restated beside it', () => {
        expect(CANONICAL_HERO_MOUNTAIN_SPEC_IDS).toEqual(
            ODYSSEY_PEAK_SPECS.filter((p) => p.role !== 'far-range').map((p) => p.id),
        );
    });

    it('the legacy module IMPORTS the authority instead of restating it', () => {
        // THIS is the assertion that pins the DIRECTION, and it exists because the
        // value-agreement tests above silently failed to. While this slice was in flight a
        // background agent reverted canonical-mountain-range.js to its pre-flip inline
        // table — and every value check in this file still passed, because the flip was
        // value-identical by construction. Agreement cannot distinguish "derives from" from
        // "happens to match": only the source can.
        const src = readFileSync(
            path.resolve(
                path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
                '../../src/rendering/odyssey/chapter-environments/shared/canonical-mountain-range.js',
            ),
            'utf8',
        );
        expect(src).toMatch(/import \{\s*ODYSSEY_PEAK_SPECS\s*\} from '\.\.\/\.\.\/world\/odyssey-peak-specs\.js'/);
        // No re-inlined geometry: the peak ids must not reappear as source literals, and
        // neither may the authored sizes/seeds that only the authority is allowed to state.
        ODYSSEY_PEAK_SPECS.forEach((peak) => {
            expect(src, `${peak.id} must not be re-inlined`).not.toContain(`'${peak.id}'`);
            expect(src, `seed ${peak.seed} must not be re-inlined`).not.toContain(String(peak.seed));
        });
    });

    it('the cone-radius fraction agrees across the divide', () => {
        // ODYSSEY_MASSIFS radii are size * PEAK_CONE_RADIUS_FRAC; the legacy displaced cone
        // reaches size * MOUNTAIN_DISPLACEMENT.coneRadiusFrac. If these two constants part
        // ways, the world's footprint and the legacy silhouette quietly describe different
        // mountains while every position check still passes.
        expect(MOUNTAIN_DISPLACEMENT.coneRadiusFrac).toBe(PEAK_CONE_RADIUS_FRAC);
    });

    it('the authority is deeply frozen data with no room for runtime mutation', () => {
        expect(Object.isFrozen(ODYSSEY_PEAK_SPECS)).toBe(true);
        ODYSSEY_PEAK_SPECS.forEach((peak) => expect(Object.isFrozen(peak)).toBe(true));
    });
});
