// @ts-check
/**
 * Selective bloom still needs explicit emissive blending in three r186: secondary
 * MRT attachments default to NoBlending. Preserve additive/alpha accumulation using
 * the material's blending mode. r186 fixes MRTNode.merge(), so no prototype patch is needed.
 */
import { BlendMode, MaterialBlending } from 'three/webgpu';

/**
 * @param {object} mrtNode - The mrt({ output, emissive, ... }) node.
 * @returns {object} The same node, for inline use in setMRT(...).
 */
export function withEmissiveMaterialBlending(mrtNode) {
    if (mrtNode && typeof mrtNode.setBlendMode === 'function' && mrtNode.has?.('emissive')) {
        mrtNode.setBlendMode('emissive', new BlendMode(MaterialBlending));
    }
    return mrtNode;
}
