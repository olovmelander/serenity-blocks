import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import {
    createNebulaFieldTSL,
    validateNebulaFieldClearance,
} from './odyssey-nebula-field.js';
import {
    ODYSSEY_NEBULA_FIELD_SPECS,
} from './odyssey-nebula-field-specs.js';
import {
    SUMMIT_EARTH_REVEAL,
    createCosmicExpanseEnvironment,
    updateCosmicExpanseEnvironment,
} from './cosmic-expanse.js';
import { deriveOdysseyChapterPositions } from '../../../core/odyssey/data/odyssey-layout.js';

// DERIVED mid-summit-window probe (was the literal 0.638, which the north-island Wave 0
// retime moved outside the window — see odyssey-comet.test.js for the full note).
const CP = deriveOdysseyChapterPositions();
const MID_SUMMIT = CP[5] - (CP[5] - CP[4])
    * ((SUMMIT_EARTH_REVEAL.startBeforeBoundary + SUMMIT_EARTH_REVEAL.endBeforeBoundary) / 2);

const here = path.dirname(fileURLToPath(import.meta.url));
const SPLIT = fs.readFileSync(
    path.resolve(here, '../../../../scripts/odyssey-gpu-split.mjs'),
    'utf8',
);

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('ch6 sculpted nebula field (Space overhaul Wave 3)', () => {
    it('the corridor axis keeps its clearance through the travel window (SDF-at-rail)', () => {
        // The rule that replaced centre-distance in the cloud-field plan: a mass 700 u
        // away by centre but 900 u wide still swallows the camera. Violations carry
        // the offending z so a failing spec edit reads as a placement, not a mystery.
        expect(validateNebulaFieldClearance()).toEqual([]);
    });

    it('sculpts the composed field into TWO opaque role draws (warm + cool)', () => {
        const field = createNebulaFieldTSL();
        expect(field.masses).toBe(ODYSSEY_NEBULA_FIELD_SPECS.length);
        // §3b re-composition: one draw per PAINT ROLE — the warm workhorses and the
        // dim cool giant must be separable materials (the forest species-role idea).
        expect(field.parts).toHaveLength(2);
        field.parts.forEach(({ mesh, material }) => {
            expect(mesh.isMesh).toBe(true);
            expect(material.transparent).toBe(false);
            expect(material.depthWrite).toBe(true);
            // Dithered opaque dissolve, never a blend state.
            expect(material.alphaTest).toBeGreaterThan(0);
            expect(material.opacityNode).toBeTruthy();
        });
        // Size hierarchy is real: 1 hero + 2 medium + 2 witnesses + pillar.
        const widths = ODYSSEY_NEBULA_FIELD_SPECS.map((s) => s.w).sort((a, b) => a - b);
        expect(widths[widths.length - 1] / widths[0]).toBeGreaterThan(6);
        // Triangle budget legible from the specs table: 4 near + 2 mid ≈ 4,920 faces.
        expect(field.triangles).toBeGreaterThan(3000);
        expect(field.triangles).toBeLessThan(9000);
    });

    it('stages its reveal via uReveal, outside the entryContinuity buckets', () => {
        vi.stubGlobal('window', { location: { search: '' } });
        const group = createCosmicExpanseEnvironment({ particleCount: 200 });
        group.userData.chapterOpacity = 1;
        const mesh = group.userData.nebulaField;
        expect(mesh).toBeTruthy();
        // NOT in the buckets — setOpacityScale would flip the opaque material
        // transparent and write the dead material.opacity.
        Object.values(group.userData.entryContinuity).forEach((bucket) => {
            expect(bucket).not.toContain(mesh);
        });

        // Pre-boundary (summit window): the space gate holds the field at zero.
        updateCosmicExpanseEnvironment(group, 0.016, 1.0, null, MID_SUMMIT);
        expect(mesh.userData.uReveal.value).toBe(0);
        expect(mesh.visible).toBe(false);

        // Settled space: fully revealed.
        updateCosmicExpanseEnvironment(group, 0.016, 2.0, null, 0.55);
        expect(mesh.userData.uReveal.value).toBeGreaterThan(0.95);
        expect(mesh.visible).toBe(true);
    });

    it('keeps the material opaque even after a chapter-opacity sweep', () => {
        vi.stubGlobal('window', { location: { search: '' } });
        const group = createCosmicExpanseEnvironment({ particleCount: 200 });
        group.userData.chapterOpacity = 0.5;
        updateCosmicExpanseEnvironment(group, 0.016, 1.0, null, 0.55);
        const fieldGroup = group.userData.nebulaField;
        fieldGroup.children.forEach((child) => {
            expect(child.material.transparent).toBe(false);
        });
        expect(fieldGroup.userData.uReveal.value).toBeCloseTo(0.5, 1);
    });

    it('gpu-split drives the swap lever the chapter reads', () => {
        expect(SPLIT).toMatch(/id:\s*'ch6-nebula-sprites',\s*flags:\s*\{\s*odysseyCh6NebulaSprites:\s*'1'/);
    });
});
