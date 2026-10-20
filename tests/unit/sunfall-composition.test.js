import { describe, expect, it } from 'vitest';
import {
    BOARD_VIEWPORT,
    SUNFALL_COMPOSITION,
    auditSunfallComposition,
    calmFactorAtNdc,
    calmMaskAtNdc,
    cameraRigFor,
    projectWorldToNdc,
    readBoardViewport,
} from '../../src/themes/sunfall/sunfall-composition.js';

describe('sunfall-composition', () => {
    it('chooses a rest rig per screen shape', () => {
        expect(cameraRigFor(390 / 844).name).toBe('portrait');
        expect(cameraRigFor(4 / 3).name).toBe('square');
        expect(cameraRigFor(16 / 9).name).toBe('landscape');
        expect(cameraRigFor(21 / 9).name).toBe('ultrawide');
        expect(cameraRigFor(NaN).name).toBe('landscape');
    });

    it('frames the 16:9 reference: oculus up left, the foot in the left free space, the far doline right', () => {
        const audit = auditSunfallComposition(16 / 9);
        const { oculus, foot, farDoline } = audit.projected;
        expect(oculus.depth).toBeGreaterThan(300);
        expect(oculus.x).toBeLessThan(-0.2);
        expect(oculus.y).toBeGreaterThan(0.5);
        expect(foot.x).toBeLessThan(-0.3);
        expect(foot.x).toBeGreaterThan(-0.9);
        expect(foot.y).toBeLessThan(-0.2);
        expect(farDoline.x).toBeGreaterThan(0.4);
        expect(farDoline.x).toBeLessThan(1);
        expect(audit.footOutsideBoard).toBe(true);
        expect(audit.boardIsCalmerThanFoot).toBe(true);
    });

    it.each([4 / 3, 16 / 9, 21 / 9])('keeps the foot of the sunfall on screen and off the board at aspect %f', (aspect) => {
        const { projected, footOutsideBoard } = auditSunfallComposition(aspect);
        expect(Math.abs(projected.foot.x)).toBeLessThan(1);
        expect(Math.abs(projected.foot.y)).toBeLessThan(1);
        expect(footOutsideBoard).toBe(true);
    });

    it('turns an upright screen toward the column so it stands in frame', () => {
        const aspect = 390 / 844;
        const rig = cameraRigFor(aspect);
        const foot = projectWorldToNdc(SUNFALL_COMPOSITION.landmarks.foot, rig, aspect);
        expect(Math.abs(foot.x)).toBeLessThan(1);
        expect(Math.abs(foot.y)).toBeLessThan(1);
    });

    it('attenuates inside the board viewport and leaves the periphery full', () => {
        expect(calmMaskAtNdc(0, 0)).toBeCloseTo(1.0, 5);
        expect(calmFactorAtNdc(0, 0)).toBeCloseTo(1 - SUNFALL_COMPOSITION.boardCalmStrength, 5);
        expect(calmMaskAtNdc(0.85, 0.75)).toBeCloseTo(0.0, 5);
        expect(calmFactorAtNdc(0.85, 0.75)).toBeCloseTo(1.0, 5);
    });

    it('falls back to the default board viewport without a DOM and reads live bounds with one', () => {
        expect(readBoardViewport(null).ndcLeft).toBeCloseTo(BOARD_VIEWPORT.ndcLeft, 5);
        const fakeDoc = {
            querySelector: () => ({
                getBoundingClientRect: () => ({
                    left: 672, right: 1248, top: 108, bottom: 972, width: 576, height: 864,
                }),
            }),
        };
        const live = readBoardViewport(fakeDoc);
        expect(live.ndcLeft).toBeLessThan(0);
        expect(live.ndcRight).toBeGreaterThan(0);
    });
});
