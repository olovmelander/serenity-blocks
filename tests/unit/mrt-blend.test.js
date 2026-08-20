import { describe, expect, it } from 'vitest';
import { BlendMode, MaterialBlending, NoBlending } from 'three/webgpu';
import { emissive, mrt, output } from 'three/tsl';
import {
    ensureMrtMergePreservesBlendModes,
    withEmissiveMaterialBlending,
} from '../../src/themes/shared/mrt-blend.js';

describe('mrt-blend (r185 MRT emissive blend restore)', () => {
    it('pins the r185 regression: a fresh MRT defaults every non-output attachment to NoBlending', () => {
        // three r185 MRTNode only seeds blendModes.output = MaterialBlending
        // (MRTNode.js:77-79); getBlendMode falls back to NoBlending (:113-117).
        // Under r181 attachments used the material's own blending — additive
        // glow materials could accumulate into the emissive bloom source.
        expect(NoBlending).toBe(0);
        expect(MaterialBlending).toBe(6);

        const fresh = mrt({ output, emissive });
        expect(fresh.getBlendMode('emissive').blending).toBe(NoBlending);
        expect(fresh.getBlendMode('output').blending).toBe(MaterialBlending);
    });

    it('withEmissiveMaterialBlending restores MaterialBlending on the emissive attachment', () => {
        const node = withEmissiveMaterialBlending(mrt({ output, emissive }));

        const blendMode = node.getBlendMode('emissive');
        expect(blendMode).toBeInstanceOf(BlendMode);
        expect(blendMode.blending).toBe(MaterialBlending);
        // The 'output' default is untouched.
        expect(node.getBlendMode('output').blending).toBe(MaterialBlending);
    });

    it('leaves MRT nodes without an emissive attachment alone', () => {
        const node = withEmissiveMaterialBlending(mrt({ output }));
        expect(node.getBlendMode('emissive').blending).toBe(NoBlending);
    });

    it('merge() with a per-material MRT preserves the emissive blend mode', () => {
        // Upstream bug: r185 MRTNode.merge() assigns the merged map to
        // mrtTarget.blendings (MRTNode.js:155) while getBlendMode reads
        // this.blendModes (:115), silently dropping setBlendMode for themes
        // with per-material `material.mrtNode = mrt({ emissive })` overrides.
        const passMrt = withEmissiveMaterialBlending(mrt({ output, emissive }));
        const materialMrt = mrt({ emissive });

        const merged = passMrt.merge(materialMrt);

        expect(merged.getBlendMode('emissive').blending).toBe(MaterialBlending);
        expect(Object.prototype.hasOwnProperty.call(merged, 'blendings')).toBe(false);
    });

    it('ensureMrtMergePreservesBlendModes is idempotent (single wrap)', () => {
        ensureMrtMergePreservesBlendModes();

        const proto = Object.getPrototypeOf(mrt({}));
        const patchedMerge = proto.merge;
        expect(patchedMerge.__sbPreservesBlendModes).toBe(true);

        ensureMrtMergePreservesBlendModes();
        expect(proto.merge).toBe(patchedMerge);
    });
});
