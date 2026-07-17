import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Pinned-version contract for src/themes/shared/bloom-dispose.js (SB-15).
//
// disposeBloomNodeDeep() reaches into BloomNode's private fields
// (_highPassFilterMaterial, _separableBlurMaterials, _compositeMaterial)
// because three r181's BloomNode.dispose() frees render targets but not its
// NodeMaterials — the defect documented in
// docs/UPSTREAM_THREE_BLOOMNODE_DISPOSE_ISSUE.md. If a three upgrade renames
// or removes those fields, the helper silently degrades to a no-op and the
// scene-retention leak returns. These tests pin the contract so an upgrade
// fails loudly here instead.

const bloomSource = readFileSync(
    new URL('../../node_modules/three/examples/jsm/tsl/display/BloomNode.js', import.meta.url),
    'utf8',
);

describe('three BloomNode private-field contract (SB-15 workaround)', () => {
    it.each([
        '_highPassFilterMaterial',
        '_compositeMaterial',
        '_separableBlurMaterials',
    ])('BloomNode still declares %s', (field) => {
        expect(bloomSource).toContain(`this.${field}`);
    });

    it('BloomNode.dispose() still omits material disposal (else the helper is redundant)', () => {
        const disposeIdx = bloomSource.indexOf('\tdispose()');
        expect(disposeIdx).toBeGreaterThan(-1);
        const disposeBody = bloomSource.slice(disposeIdx, bloomSource.indexOf('\t}', disposeIdx));
        const disposesMaterials = /Material.*\.dispose\(\)|_separableBlurMaterials\[/.test(disposeBody);
        if (disposesMaterials) {
            // Upstream fixed it — the helper (and this test) can be retired.
            // Fail loudly so the pinned workaround gets removed deliberately
            // rather than double-disposing forever.
            throw new Error(
                'three\'s BloomNode.dispose() now disposes its materials — retire '
                + 'disposeBloomNodeDeep (src/themes/shared/bloom-dispose.js) and this contract test.',
            );
        }
    });

    it('disposeBloomNodeDeep targets exactly the pinned field names', () => {
        const helperSource = readFileSync(
            new URL('../../src/themes/shared/bloom-dispose.js', import.meta.url),
            'utf8',
        );
        expect(helperSource).toContain('_highPassFilterMaterial');
        expect(helperSource).toContain('_compositeMaterial');
        expect(helperSource).toContain('_separableBlurMaterials');
    });
});
