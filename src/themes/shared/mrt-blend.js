// @ts-check

/**
 * MRT emissive blend restore for three r185's selective-bloom regression.
 *
 * r185 makes every MRT attachment except 'output' opaque (NoBlending) by
 * default: MRTNode's constructor only seeds `blendModes = { output:
 * MaterialBlending }` (three/src/nodes/core/MRTNode.js:77-79) and
 * getBlendMode() falls back to NoBlending for everything else (:113-117).
 * Under r181 every attachment used the material's own blending, which this
 * repo's selective-bloom pattern relies on: additive glow materials must
 * ACCUMULATE into the emissive buffer, not stomp black over it.
 *
 * The sanctioned fix is mrtNode.setBlendMode('emissive', new
 * BlendMode(MaterialBlending)) on the pass-level MRT — but r185's
 * MRTNode.merge() has an upstream bug that silently drops it for themes with
 * per-material `material.mrtNode = mrt({ emissive })` overrides: merge()
 * assigns the combined map to `mrtTarget.blendings` (MRTNode.js:155) while
 * getBlendMode() reads `this.blendModes` (:115), so the merged node reverts
 * to the NoBlending default. ensureMrtMergePreservesBlendModes() patches
 * merge() once, module-wide, to move the stray `blendings` map onto
 * `blendModes`. Note `blendings` is written at that ONE line and read nowhere
 * else in three — a dead write, which is why the loss is silent.
 *
 * UPSTREAM STATUS, verified 2026-08-23 — DELETION CANDIDATE, NOT PERMANENT.
 * Already FIXED on three's `dev`: merge() now assigns `mrtTarget.blendModes`
 * (and gained a `clearColors` merge alongside it). It is in NO release yet —
 * 0.185.1 is still the latest published version — so this patch is required
 * today. Do not file it upstream; it is fixed, just unreleased.
 *
 * On the move to r186+, DELETE this module and its call sites rather than
 * carrying it. The wrapper is already inert against a fixed three: it acts only
 * `if (merged.hasOwnProperty('blendings'))`, which a fixed merge() never sets.
 * So an upgrade will silently stop exercising it, and a patch nobody notices has
 * stopped running is worse than no patch. Re-verify emissive accumulation with a
 * selective-bloom capture at that point either way (ADR-0007).
 */

import { BlendMode, MaterialBlending } from 'three/webgpu';
import { mrt } from 'three/tsl';

const MERGE_PATCH_FLAG = '__sbPreservesBlendModes';

/**
 * Idempotently patches MRTNode.prototype.merge so merged MRT nodes keep
 * their blend modes (see file header). The prototype is reached through a
 * throwaway instance so no MRTNode class import is needed.
 */
export function ensureMrtMergePreservesBlendModes() {
    const proto = Object.getPrototypeOf(mrt({}));
    if (!proto || typeof proto.merge !== 'function' || proto.merge[MERGE_PATCH_FLAG]) return;

    const originalMerge = proto.merge;

    /** @this {object} */
    function mergePreservingBlendModes(mrtNode) {
        const merged = originalMerge.call(this, mrtNode);
        if (merged && Object.prototype.hasOwnProperty.call(merged, 'blendings')) {
            merged.blendModes = merged.blendings;
            delete merged.blendings;
        }
        return merged;
    }

    mergePreservingBlendModes[MERGE_PATCH_FLAG] = true;
    proto.merge = mergePreservingBlendModes;
}

/**
 * Restores the r181 behavior for a pass-level MRT node: the 'emissive'
 * attachment blends with the MATERIAL's own blending mode, so additive glow
 * materials accumulate into the bloom source again. Also arms the merge()
 * patch so per-material mrtNode overrides do not drop the blend mode.
 *
 * @param {object} mrtNode - The mrt({ output, emissive, ... }) node.
 * @returns {object} The same node, for inline use in setMRT(...).
 */
export function withEmissiveMaterialBlending(mrtNode) {
    ensureMrtMergePreservesBlendModes();

    if (mrtNode && typeof mrtNode.setBlendMode === 'function' && mrtNode.has?.('emissive')) {
        mrtNode.setBlendMode('emissive', new BlendMode(MaterialBlending));
    }

    return mrtNode;
}
