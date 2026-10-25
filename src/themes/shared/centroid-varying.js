/**
 * A vertex value as the fragment stage reads it on a multisampled target: taken inside the
 * triangle. Under MSAA a pixel is shaded once, at its centre, even when a triangle covers only one
 * of its samples; for a thin triangle (a needle tip, a twig, anything far off) the centre lies
 * well outside it, and the value comes out extrapolated far past what its corners hold. Whatever
 * squares or sharpens it then blazes in that one pixel and is gone the next frame, as the wind
 * moves the triangle across the samples: a white speckle crawling over a far crown. Centroid
 * sampling takes the value at a point the triangle covers. On a single-sampled target it is the
 * same as the default.
 */
import { varying } from 'three/tsl';

/**
 * @param {object} node the value (a TSL node), built in the vertex stage
 * @param {string} [name] the varying's name in the generated shader
 */
export const centroidVarying = (node, name) => varying(node, name).setInterpolation('perspective', 'centroid');
