import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    createNebulaFieldTSL,
    validateNebulaFieldClearance,
} from './odyssey-nebula-field.js';
import {
    NEBULA_FIELD_CLEARANCE,
    ODYSSEY_NEBULA_FIELD_SPECS,
} from './odyssey-nebula-field-specs.js';
import {
    createCosmicExpanseEnvironment,
    updateCosmicExpanseEnvironment,
} from './cosmic-expanse.js';

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

    it('sculpts five masses into ONE opaque draw', () => {
        const field = createNebulaFieldTSL({});
        expect(field.masses).toBe(ODYSSEY_NEBULA_FIELD_SPECS.length);
        expect(field.mesh.isMesh).toBe(true);
        expect(field.material.transparent).toBe(false);
        expect(field.material.depthWrite).toBe(true);
        // Dithered opaque dissolve, never a blend state.
        expect(field.material.alphaTest).toBeGreaterThan(0);
        expect(field.material.opacityNode).toBeTruthy();
        // Triangle budget legible from the specs table: 3 near + 2 mid ≈ 3,940 faces.
        expect(field.triangles).toBeGreaterThan(2000);
        expect(field.triangles).toBeLessThan(8000);
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
        updateCosmicExpanseEnvironment(group, 0.016, 1.0, null, 0.638);
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
        const mesh = group.userData.nebulaField;
        expect(mesh.material.transparent).toBe(false);
        expect(mesh.userData.uReveal.value).toBeCloseTo(0.5, 1);
    });

    it('gpu-split drives the swap lever the chapter reads', () => {
        expect(SPLIT).toMatch(/id:\s*'ch6-nebula-sprites',\s*flags:\s*\{\s*odysseyCh6NebulaSprites:\s*'1'/);
    });
});
