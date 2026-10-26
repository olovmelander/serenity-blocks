import {
    atan, clamp, cross, float, fwidth, length, max, normalize, select, sin, smoothstep, sqrt, vec2, vec3,
} from 'three/tsl';
import { FOREST_PUFF_CARD } from './odyssey-forest-geometry.js';

/**
 * PUFF CARDS, the shader half (see FOREST_PUFF_CARD in odyssey-forest-geometry.js).
 *
 * Shared by the world's forest material and the tree audition board, so the board shows the mid
 * and far tiers as the game draws them.
 */

/**
 * Vertex stage: turn a card to face the eye.
 *
 * @param {object} p
 * @param {Node} p.centre  the card's centre after the instance transform, in the same frame as `eye`
 * @param {Node} p.raw     the card's `normal` attribute: (u, v, radius in the tree's units)
 * @param {Node} p.scale   the tree's horizontal instance scale
 * @param {Node} p.eye     the eye, in that frame
 * @returns {{offset: Node, right: Node, up: Node}} the corner's offset from the centre, and the
 *   card's axes (constant over a card, for the fragment stage)
 */
export function forestCardVertex({
    centre, raw, scale, eye,
}) {
    const C = FOREST_PUFF_CARD;
    const toEye = normalize(eye.sub(centre));
    const right = normalize(cross(vec3(0, 1, 0), toEye));
    const up = cross(toEye, right);
    // The quad spans the puff's outline: one radius either side, `flatten` above the centre and
    // `flatten * belly` below it.
    const lift = select(raw.y.greaterThan(0), raw.y.mul(C.flatten), raw.y.mul(C.flatten * C.belly));
    const radius = raw.z.mul(scale);
    const offset = right.mul(raw.x).add(up.mul(lift)).add(toEye.mul(C.push)).mul(radius);
    return { offset, right, up };
}

/**
 * Fragment stage: the puff drawn on its card.
 *
 * @param {object} p
 * @param {Node} p.raw    the card's `normal` attribute, interpolated: (u, v) across the quad
 * @param {Node} p.right  the card's right axis (from the vertex stage)
 * @param {Node} p.up     the card's up axis (from the vertex stage)
 * @param {Node} p.phase  the card's own turn of the scalloped outline, radians
 * @returns {{alpha: Node, normal: Node, radialY: Node}} the coverage ramp (0.5 at the outline),
 *   the hero puff's normal (radial, leaned up) and the radial's height, for the cap's openness
 */
export function forestCardFragment({
    raw, right, up, phase,
}) {
    const C = FOREST_PUFF_CARD;
    // v runs linearly over the quad's height, -flatten*belly .. +flatten: back to the sphere's
    // own coordinate, squashed by the belly below the centre.
    const above = raw.y.add(1).mul(0.5).mul(1 + C.belly).sub(C.belly);
    const sy = select(above.greaterThan(0), above, above.div(C.belly));
    const sx = raw.x;
    const rho = length(vec2(sx, sy));
    const turn = atan(sy, sx);
    // The scallops fade as the card shrinks on screen (fwidth(rho) is about 1.4 / its radius in
    // pixels): from ~25 px down to ~10 px, where a lobe would be under a pixel and only shimmer.
    const leafy = float(1).sub(smoothstep(float(C.scallopFade[0]), float(C.scallopFade[1]), fwidth(rho)));
    const edge = float(1)
        .sub(sin(turn.mul(C.lobes).add(phase)).mul(0.5).add(0.5).mul(leafy.mul(C.scallop)))
        .sub(sin(turn.mul(C.lobes2).add(phase.mul(1.7))).mul(0.5).add(0.5).mul(leafy.mul(C.scallop2)));
    const alpha = clamp(edge.sub(rho).mul(C.edgeGain).add(0.5), 0, 1);
    const toEye = cross(right, up);
    const depth = sqrt(max(float(1).sub(sx.mul(sx)).sub(sy.mul(sy)), 0));
    const radial = normalize(right.mul(sx).add(up.mul(sy)).add(toEye.mul(depth)));
    const normal = normalize(radial.add(vec3(0, C.upBias, 0)));
    return { alpha, normal, radialY: radial.y };
}
