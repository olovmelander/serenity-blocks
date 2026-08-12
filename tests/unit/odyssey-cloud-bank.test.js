import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
    CLOUD_BANK_RADIUS,
    CLOUD_BANK_Y_SCALE,
    createCloudBank,
} from '../../src/rendering/odyssey/composition/odyssey-cloud-bank.js';
import { SEAM_56_AURORA_BRIDGE } from '../../src/rendering/odyssey/chapter-environments/shared/seam-bridges.js';

/**
 * THE CLOUD BANK — the ch5 -> ch6 occlusion moment, the steam quench's sibling.
 * Same contract discipline: tests hold the driver curves and the material contract; the
 * look is capture-verified (ADR-0007). Two properties are bank-specific and load-bearing:
 * it is a stratus LENS (Y-squashed), and its palette derives from SEAM_56_AURORA_BRIDGE by
 * IMPORT — the moment must stay continuous with the authored handoff, and deriving rather
 * than restating is this repo's hard-won rule (see the spec-authority flip).
 */
describe('cloud bank driver', () => {
    it('is fully dense at the boundary, absent at the window edges, eased not linear', () => {
        const density = (seamT) => {
            const t = Math.max(0, Math.min(1, seamT));
            const tri = 1 - Math.abs((t * 2) - 1);
            return tri * tri;
        };
        expect(density(0.5)).toBeCloseTo(1, 6);
        expect(density(0)).toBeCloseTo(0, 6);
        expect(density(1)).toBeCloseTo(0, 6);
        expect(density(0.25)).toBeLessThan(0.3);
    });

    it('survives out-of-range and non-finite seamT', () => {
        const bank = createCloudBank();
        expect(() => { bank.update(0, -2); bank.update(0, 9); bank.update(0, NaN); }).not.toThrow();
        bank.dispose();
    });
});

describe('cloud bank material contract', () => {
    it('is a Y-squashed occluder the camera flies through', () => {
        const bank = createCloudBank();
        expect(bank.mesh.scale.y).toBe(CLOUD_BANK_Y_SCALE);
        expect(bank.mesh.scale.y).toBeLessThan(0.5); // a stratus lens, not a ball
        expect(bank.mesh.material.side).toBe(1); // BackSide
        expect(bank.mesh.frustumCulled).toBe(false);
        expect(bank.mesh.material.transparent).toBe(true);
        expect(bank.mesh.material.depthWrite).toBe(false);
        expect(bank.mesh.material.fog).toBe(false); // the 4x-recurring scene-fog trap
        expect(bank.mesh.geometry.parameters.radius).toBe(CLOUD_BANK_RADIUS);
        bank.dispose();
    });

    it('derives its palette from SEAM_56_AURORA_BRIDGE by import, not by restating hexes', () => {
        const src = readFileSync(
            path.resolve(
                path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
                '../../src/rendering/odyssey/composition/odyssey-cloud-bank.js',
            ),
            'utf8',
        );
        expect(src).toMatch(/import \{ SEAM_56_AURORA_BRIDGE \} from/);
        // The bridge's fog + ambient hexes must not be re-inlined as literals.
        const fogHex = SEAM_56_AURORA_BRIDGE.fogColor.toString(16);
        const ambHex = SEAM_56_AURORA_BRIDGE.ambientLight.toString(16);
        expect(src.toLowerCase()).not.toContain(`0x${fogHex}`);
        expect(src.toLowerCase()).not.toContain(`0x${ambHex}`);
    });
});

describe('cloud bank board wiring', () => {
    const BOARD = readFileSync(
        path.resolve(
            path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
            '../../src/rendering/odyssey/OdysseyBoardController.js',
        ),
        'utf8',
    );

    it('seats the bank on the rail at the 5->6 boundary and gates it to its window', () => {
        expect(BOARD).toMatch(/const boundary56 = this\.presentationLayout\?\.chapterPositions\?\.\[5\]/);
        expect(BOARD).toMatch(/this\.cloudBank\.mesh\.visible = inWindow;/);
        expect(BOARD).toMatch(/if \(inWindow\) this\.cloudBank\.update\(this\.time,/);
    });

    it('cannot take the board down if it fails to build, and is disposed', () => {
        expect(BOARD).toMatch(/console\.warn\('\[OdysseyBoard\] cloud bank unavailable \(non-fatal\)/);
        expect(BOARD).toMatch(/this\.cloudBank\.dispose\(\);/);
    });
});
