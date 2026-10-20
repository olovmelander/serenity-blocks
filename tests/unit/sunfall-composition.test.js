import { describe, expect, it } from 'vitest';
import {
    BOARD_VIEWPORT,
    SUNFALL_COMPOSITION,
    auditSunfallComposition,
    calmFactorAtNdc,
    calmMaskAtNdc,
    projectWorldToNdc,
    readBoardViewport,
    verifyFocalSeparations,
} from '../../src/themes/sunfall/sunfall-composition.js';

describe('sunfall-composition', () => {
    it('passes the full composition and focal-point separation audit', () => {
        const audit = auditSunfallComposition();
        expect(audit.valid).toBe(true);
        expect(audit.oculusToFar).toBeGreaterThanOrEqual(
            SUNFALL_COMPOSITION.minFocalSeparationNdc,
        );
        expect(audit.oculusToPool).toBeGreaterThanOrEqual(
            SUNFALL_COMPOSITION.minFocalSeparationNdc,
        );
        expect(audit.centerCalm).toBeCloseTo(0.15, 2);
        expect(audit.boardIsCalmerThanBeam).toBe(true);
    });

    it('projects 3D doline landmarks into their designated peripheral NDC quadrants', () => {
        const oculus = projectWorldToNdc(SUNFALL_COMPOSITION.landmarks.oculus);
        const pool = projectWorldToNdc(SUNFALL_COMPOSITION.landmarks.pool);
        const farDoline = projectWorldToNdc(SUNFALL_COMPOSITION.landmarks.farDoline);

        expect(oculus.x).toBeGreaterThan(0.10);
        expect(oculus.y).toBeGreaterThan(0.25);

        expect(pool.x).toBeGreaterThan(0.05);
        expect(pool.y).toBeLessThan(-0.10);

        expect(farDoline.x).toBeLessThan(-0.08);
    });

    it('maintains clear NDC separation between all focal landmarks', () => {
        const sep = verifyFocalSeparations();
        expect(sep.valid).toBe(true);
        expect(sep.oculusToFar).toBeGreaterThanOrEqual(SUNFALL_COMPOSITION.minFocalSeparationNdc);
        expect(sep.oculusToPool).toBeGreaterThanOrEqual(SUNFALL_COMPOSITION.minFocalSeparationNdc);
        expect(sep.goursSpan).toBeGreaterThanOrEqual(0.5);
    });

    it('attenuates volumetric brightness inside the central board viewport while keeping periphery full', () => {
        expect(calmMaskAtNdc(-0.08, 0)).toBeCloseTo(1.0, 5);
        expect(calmFactorAtNdc(-0.08, 0)).toBeCloseTo(1 - SUNFALL_COMPOSITION.boardCalmStrength, 5);

        expect(calmMaskAtNdc(0.85, 0.75)).toBeCloseTo(0.0, 5);
        expect(calmFactorAtNdc(0.85, 0.75)).toBeCloseTo(1.0, 5);
    });

    it('falls back to default board viewport when DOM is absent and reads live bounds when present', () => {
        const fallback = readBoardViewport(null);
        expect(fallback.ndcLeft).toBeCloseTo(BOARD_VIEWPORT.ndcLeft, 5);

        const fakeDoc = {
            querySelector: () => ({
                getBoundingClientRect: () => ({
                    left: 672,
                    right: 1248,
                    top: 108,
                    bottom: 972,
                    width: 576,
                    height: 864,
                }),
            }),
        };
        const live = readBoardViewport(fakeDoc);
        expect(live.ndcLeft).toBeLessThan(0);
        expect(live.ndcRight).toBeGreaterThan(0);
    });
});
