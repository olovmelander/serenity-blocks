import { describe, expect, it } from 'vitest';

import {
    KOI_POND_LAYOUT,
    getKoiPondPixelRatioCap,
    mapKoiPondSideLaneToWorld,
    normalizeKoiPondQuality,
    resolveKoiPondCameraPose,
    sampleKoiPondGroundHeight,
} from '../../src/themes/koi-pond/rendering/koi-pond-layout.js';

describe('Koi Pond production layout', () => {
    it('normalizes every authored quality tier case-insensitively', () => {
        expect(normalizeKoiPondQuality('minimal')).toBe('Minimal');
        expect(normalizeKoiPondQuality('EXTREME')).toBe('Extreme');
        expect(normalizeKoiPondQuality('unknown')).toBe('High');
    });

    it('keeps production DPR caps inside the measured 1.5 ceiling', () => {
        expect(getKoiPondPixelRatioCap('Minimal')).toBe(0.8);
        expect(getKoiPondPixelRatioCap('High')).toBe(1.35);
        expect(getKoiPondPixelRatioCap('Extreme')).toBe(1.5);
    });

    it('maps left and right router lanes to mirrored pond positions', () => {
        const left = mapKoiPondSideLaneToWorld({
            sideLane: { side: 'left', normalized: { y: 0.5 } },
        });
        const right = mapKoiPondSideLaneToWorld({
            sideLane: { side: 'right', normalized: { y: 0.5 } },
        });

        expect(left).toMatchObject({ x: -10.9, y: 0.3 });
        expect(right).toMatchObject({ x: 10.9, y: 0.3 });
        expect(left.z).toBeCloseTo(-5.5);
        expect(right.z).toBeCloseTo(-5.5);
    });

    it('clamps malformed lane depth and preserves the board sanctuary contract', () => {
        expect(mapKoiPondSideLaneToWorld({
            sideLane: { side: 'right', normalized: { y: 9 } },
        }).z).toBeCloseTo(5.1);
        expect(KOI_POND_LAYOUT.boardSanctuary).toMatchObject({
            width: 7.3,
            depth: 13.2,
        });
    });

    it('keeps pointer camera parallax bounded around the canonical pose', () => {
        const pose = resolveKoiPondCameraPose({ x: 4, y: -3 });

        expect(pose.position.x).toBeCloseTo(
            KOI_POND_LAYOUT.camera.position.x
                + KOI_POND_LAYOUT.camera.parallax.position.x,
        );
        expect(pose.position.y).toBeCloseTo(
            KOI_POND_LAYOUT.camera.position.y
                - KOI_POND_LAYOUT.camera.parallax.position.y,
        );
        expect(pose.target.x).toBeCloseTo(
            KOI_POND_LAYOUT.camera.target.x
                + KOI_POND_LAYOUT.camera.parallax.target.x,
        );
    });

    it('authors a raised woodland shelf beyond the wet shoreline', () => {
        const shore = sampleKoiPondGroundHeight(20, -6);
        const shelf = sampleKoiPondGroundHeight(27, -6);

        expect(shore).toBeCloseTo(-0.18);
        expect(shelf).toBeGreaterThan(shore);
    });

    it('keeps the moon behind the far ridge and grounds the guardian on terrain', () => {
        expect(KOI_POND_LAYOUT.moon.position.z).toBeLessThan(-50);
        expect(KOI_POND_LAYOUT.moon.radius).toBeGreaterThan(2);

        const { position } = KOI_POND_LAYOUT.guardian;
        expect(Math.hypot(
            position.x / KOI_POND_LAYOUT.pondRadii.x,
            (position.z - KOI_POND_LAYOUT.pondCenter.z)
                / KOI_POND_LAYOUT.pondRadii.z,
        )).toBeGreaterThan(1);
        expect(sampleKoiPondGroundHeight(position.x, position.z))
            .toBeGreaterThan(-0.18);
    });
});
