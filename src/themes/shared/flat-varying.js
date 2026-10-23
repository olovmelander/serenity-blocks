/**
 * A primitive's own numbers (a seed, a kind, an index) as the fragment stage reads them: flat, not
 * interpolated. Interpolated across a triangle, a value that is the same at its three corners comes
 * out a few bits off from pixel to pixel, and a hash of it, a floor of it or an exact test on it
 * then changes from one pixel to the next: a speckle, a crawling fringe, a wrong colour here and
 * there. `either`: any corner's value will do, they are all the same (and WebGPU's compatibility
 * mode accepts no other flat sampling).
 */
import { varying } from 'three/tsl';

/**
 * @param {object} node the value (a TSL node), built in the vertex stage
 * @param {string} name the varying's name in the generated shader
 */
export const flatVarying = (node, name) => varying(node, name).setInterpolation('flat', 'either');
