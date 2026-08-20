import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Pinned-version contract for src/themes/shared/bloom-dispose.js (SB-15).
//
// three r185's BloomNode.dispose() disposes its internal NodeMaterials
// (_highPassFilterMaterial, _compositeMaterial, _separableBlurMaterials), so
// the helper no longer disposes them itself — it only severs the node graphs
// so the material parked on BloomNode's module-level shared QuadMesh cannot
// retain the disposed theme scene. These tests pin both halves of that split:
// if a future three stops disposing the materials, or renames the private
// fields the severing loop reaches into, the upgrade fails loudly here instead
// of silently reintroducing the scene-retention leak.

const bloomSource = readFileSync(
    new URL('../../node_modules/three/examples/jsm/tsl/display/BloomNode.js', import.meta.url),
    'utf8',
);

const helperSource = readFileSync(
    new URL('../../src/themes/shared/bloom-dispose.js', import.meta.url),
    'utf8',
);

describe('three BloomNode private-field contract (SB-15 severing)', () => {
    it.each([
        '_highPassFilterMaterial',
        '_compositeMaterial',
        '_separableBlurMaterials',
    ])('BloomNode still declares %s', (field) => {
        expect(bloomSource).toContain(`this.${field}`);
    });

    it('BloomNode.dispose() disposes its materials (r185 upstream fix)', () => {
        const disposeIdx = bloomSource.indexOf('\tdispose()');
        expect(disposeIdx).toBeGreaterThan(-1);
        // The method body ends at the first line that is exactly '\t}' — nested
        // blocks inside dispose() close at deeper indentation ('\t\t}').
        const disposeEnd = bloomSource.indexOf('\n\t}', disposeIdx);
        expect(disposeEnd).toBeGreaterThan(disposeIdx);
        const disposeBody = bloomSource.slice(disposeIdx, disposeEnd);
        const message = 'three\'s BloomNode.dispose() no longer disposes this '
            + 'material — disposeBloomNodeDeep (src/themes/shared/bloom-dispose.js) '
            + 'must re-grow its material-dispose loop or the SB-15 leak returns.';
        expect(disposeBody, message).toMatch(/_highPassFilterMaterial\.dispose\(\)/);
        expect(disposeBody, message).toMatch(/_compositeMaterial\.dispose\(\)/);
        expect(disposeBody, message).toMatch(/_separableBlurMaterials\[\s*i\s*\]\.dispose\(\)/);
    });

    it('disposeBloomNodeDeep severs exactly the pinned field names', () => {
        expect(helperSource).toContain('bloomNode._highPassFilterMaterial');
        expect(helperSource).toContain('bloomNode._compositeMaterial');
        expect(helperSource).toContain('bloomNode._separableBlurMaterials');
        expect(helperSource).toContain('material.fragmentNode = null');
        expect(helperSource).toContain('material.colorNode = null');
        expect(helperSource).toContain('material.outputNode = null');
    });

    it('disposeBloomNodeDeep no longer disposes materials (upstream owns that)', () => {
        expect(helperSource).not.toMatch(/material\.dispose/);
    });
});
