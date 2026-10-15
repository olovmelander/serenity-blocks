/**
 * Uploads for instance pools that are rewritten from instance 0 every frame (glows, lanterns):
 * only the instances drawn this frame go to the GPU, not the whole pool, and nothing goes when
 * nothing is drawn. Three uploads an attribute whole unless it carries update ranges, so a pool
 * of a few hundred instances otherwise sent tens of KB a frame for the handful it drew.
 */

/**
 * Mark the first `used` elements of each attribute (or interleaved buffer) for upload.
 * `used` counts array elements: instances x item size (or x stride, for an interleaved buffer).
 * @param {Array<{clearUpdateRanges: Function, addUpdateRange: Function, needsUpdate: boolean}>} buffers
 * @param {number} used
 */
export function uploadUsed(buffers, used) {
    if (!(used > 0)) return;
    for (const buffer of buffers) {
        buffer.clearUpdateRanges();
        buffer.addUpdateRange(0, used);
        buffer.needsUpdate = true;
    }
}
